import { browser } from 'wxt/browser';
import { z, type ZodType } from 'zod';
import { logDegraded } from '@/platform/diagnostics';

/** 隔离区单条原始数据的体积上限（超出只留摘要，避免撑爆 local 配额）。 */
const QUARANTINE_ENTRY_LIMIT = 32 * 1024;

/**
 * 深拷贝（结构化克隆优先，不可用时退化为 JSON 往返）。
 *
 * 仓库默认值与落盘数据都是 JSON 同构的纯数据，两种方式等价；structuredClone
 * 在极端环境（旧运行时）缺失时不能让读取降级链路崩掉，故保留 JSON 兜底。
 *
 * 注意：**仅用于 JSON 同构值** —— JSON 兜底会丢掉 `undefined`、函数、
 * Map/Date 等非 JSON 值（Date 退化为字符串），本仓库不涉及这类值。
 */
function cloneValue<V>(value: V): V {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as V;
}

/**
 * 数据仓库：单 key 的读写 + 校验 + 变更订阅（chrome.storage.local 通道）。
 *
 * 读写管线：
 *  - 写入：schema.parse 通过后落盘；
 *  - 读取：safeParse 失败 → 坏数据隔离（写入隔离区供诊断）+ 返回默认值；
 *  - 订阅：storage.onChanged 过滤本 key，解析后回调。
 *
 * 存储不可用（权限被策略禁用）时降级为内存态（写入静默跳过并告警回调）。
 *
 * write 返回是否落盘成功：关键业务（如快照）必须检查返回值并向用户提示失败。
 */

interface DataRepositoryOptions {
  /** 存储不可用时告警。 */
  onUnavailable?: () => void;
}

export class DataRepository<T> {
  constructor(
    private readonly key: string,
    private readonly schema: ZodType<T>,
    private readonly defaultValue: T,
    private readonly options: DataRepositoryOptions = {}
  ) {}

  /**
   * 默认值的深拷贝（经 schema 重解析）。
   *
   * 直接把 `this.defaultValue` 交出去等于把仓库持有的同一对象给了调用方：默认值
   * 多是字面量 `[]`，任一消费方原地 `push/sort` 即永久污染默认值，此后每次读盘
   * 都带脏数据。`watch()` 已为同一隐患做了防护（见其注释），`read()` 同口径。
   */
  private cloneDefault(): T {
    // 默认值本身不合法时不能抛：本方法被 read() 的降级分支调用（含 try 之外的
    // 「存储不可用」分支），抛错会把「降级返回默认值」变成「读取整条链路崩掉」。
    // schema 化克隆失败时退回结构化深拷贝——共享引用被消费方原地改动的隐患
    // 仍在防护范围内，只是不再附带归一化。
    const parsed = this.schema.safeParse(this.defaultValue);
    if (parsed.success) return parsed.data;
    logDegraded('storage', `默认值未通过 schema 校验（${this.key}），已回退为原始默认值`);
    return cloneValue(this.defaultValue);
  }

  async read(): Promise<T> {
    const area = browser.storage?.local;
    if (!area) {
      this.options.onUnavailable?.();
      return this.cloneDefault();
    }
    try {
      const stored = await area.get(this.key);
      const raw = stored[this.key];
      if (raw === undefined) return this.cloneDefault();
      const parsed = this.schema.safeParse(raw);
      if (parsed.success) return parsed.data;

      // 数组类数据：逐元素尝试恢复，丢弃坏元素而非整块丢弃（如文件夹列表中单个坏条目不应连累全部）。
      if (this.schema instanceof z.ZodArray && Array.isArray(raw)) {
        const arrSchema = this.schema as unknown as z.ZodArray<z.ZodTypeAny>;
        const recovered = raw.flatMap((item) => {
          const r = arrSchema.element.safeParse(item);
          return r.success ? [r.data] : [];
        });
        const reparsed = this.schema.safeParse(recovered);
        if (reparsed.success) {
          // 把恢复后的干净数据回写，避免下次仍走失败分支。
          // 回写结果必须留痕：配额接近上限时回写恒失败，此后每次读取都会重跑一遍
          // 逐元素恢复（大数组上是每次读盘都付出的固定开销），而诊断里毫无痕迹。
          const written = await this.write(reparsed.data as T);
          if (!written) {
            logDegraded('storage', `坏数据恢复后回写失败（${this.key}），下次读取将重复走恢复分支`);
          }
          return reparsed.data as T;
        }
      }

      // 坏数据隔离：不扩散、可诊断
      await this.isolateCorrupted(raw);
      return this.cloneDefault();
    } catch (error) {
      logDegraded('storage', `数据读取失败（${this.key}）`, error);
      this.options.onUnavailable?.();
      return this.cloneDefault();
    }
  }

  /** 写入。返回是否真实落盘（quota 超限/schema 校验失败/存储不可用均为 false）。 */
  async write(value: T): Promise<boolean> {
    const area = browser.storage?.local;
    if (!area) {
      this.options.onUnavailable?.();
      return false;
    }
    try {
      await area.set({ [this.key]: this.schema.parse(value) });
      return true;
    } catch (error) {
      logDegraded('storage', `数据写入失败（${this.key}）`, error);
      this.options.onUnavailable?.();
      return false;
    }
  }

  /** 订阅本 key 的变更（其他页面/背景写入时同步）。 */
  watch(onChange: (value: T) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local') return;
      const change = changes[this.key];
      if (!change) return;
      if (change.newValue === undefined) {
        // 经 cloneDefault 出一份深拷贝：直接传 defaultValue 引用会让订阅方
        // 拿到仓库持有的同一对象，将来任一订阅方原地修改数组即污染默认值。
        // 必须走 cloneDefault：schema.parse 在默认值不合法时会**抛出**，而本回调
        // 运行在 storage.onChanged 监听器内，抛出既不会被 read() 的 try 捕获，
        // 也没有调用方可捕获 —— 一次坏默认值就让整条订阅链路静默失效。
        onChange(this.cloneDefault());
        return;
      }
      const parsed = this.schema.safeParse(change.newValue);
      if (!parsed.success) {
        // 校验失败必须留痕：静默跳过会让订阅方停在旧值，与磁盘不一致且无从排查。
        logDegraded('storage', `订阅数据校验失败（${this.key}），已跳过本次回放`, parsed.error);
        return;
      }
      onChange(parsed.data);
    };
    browser.storage?.onChanged?.addListener(listener);
    return () => browser.storage?.onChanged?.removeListener(listener);
  }

  get keyName(): string {
    return this.key;
  }

  /**
   * 坏数据隔离：不扩散、可诊断。
   *
   * 单条体积必须设上限：坏数据可能是一整份 MB 级快照数组，原样塞进隔离区会
   * 把 storage.local 撑到 QUOTA_BYTES 上限，导致**后续所有**写入连带失败 ——
   * 隔离本意是兜底，反而制造了更大的故障。超限只保留可诊断的摘要。
   */
  private async isolateCorrupted(raw: unknown): Promise<void> {
    try {
      const serialized = JSON.stringify(raw) ?? '';
      const entry: Record<string, unknown> = {
        key: this.key,
        at: new Date().toISOString(),
        size: serialized.length
      };
      if (serialized.length <= QUARANTINE_ENTRY_LIMIT) {
        entry.raw = raw;
      } else {
        entry.truncated = true;
        entry.head = serialized.slice(0, 512);
      }
      const quarantine = await browser.storage.local.get('tabs.quarantine');
      const list = (quarantine['tabs.quarantine'] as unknown[]) || [];
      list.push(entry);
      await browser.storage.local.set({ 'tabs.quarantine': list.slice(-20) });
    } catch (error) {
      // 隔离失败不影响主流程
      logDegraded('storage', `坏数据隔离失败（${this.key}）`, error);
    }
  }
}

/**
 * 清空本机存储区域：local → session。
 *
 * 调用方必须在**之前**先清掉浏览器账号同步镜像（传入 `clearMirror`）：
 * 首启恢复标志（seeded）随 local 一并被清掉，若镜像还在，下次初始化会把它当成
 * 「跨设备首启」把旧数据原样复活回来，用户看到的「已清空」是假的。
 *
 * 存储拓扑（有哪些区域、按什么顺序清）只应有一处知道，因此收口在 platform：
 * 此前这段语义写在 store 里并直连 `browser.storage`，新增存储分区时极易漏清。
 *
 * 镜像清理以回调传入而非本模块直接依赖 SyncMirror：镜像是独立能力，由编排方
 * （store）决定「要不要清、清哪些」，仓库层不反过来依赖它。
 */
export async function clearAllStoredData(clearMirror: () => Promise<void>): Promise<void> {
  await clearMirror();
  await browser.storage.local.clear();
  await browser.storage.session.clear();
}
