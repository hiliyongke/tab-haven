import { browser } from 'wxt/browser';
import { z, type ZodType } from 'zod';
import { logDegraded } from '@/platform/diagnostics';
import { QUARANTINE_RMW_LOCK, withCrossPageLock } from './crossPageLock';
import { QUARANTINE_KEY } from './keys';

/** 隔离区单条原始数据的体积上限（超出只留摘要，避免撑爆 local 配额）。 */
const QUARANTINE_ENTRY_LIMIT = 32 * 1024;
// 隔离区键名见 @/platform/storage/keys（PRIVACY.md 第 3 节登记的 32KB / 最近 20 条口径即指本品）。
/** 超限条目保留的头部字节数：够定位数据类型与字段，不足以撑爆配额。 */
const QUARANTINE_HEAD_BYTES = 512;
/** 隔离区保留的条目数：只留最近的若干条，隔离区自身不得成为无界增长面。 */
const QUARANTINE_MAX_ENTRIES = 20;

/**
 * 取 ZodArray 的元素 schema。
 *
 * zod 的 ZodArray 泛型不协变，`instanceof z.ZodArray` 收窄之后仍然取不到
 * `.element`，于是每个需要逐元素恢复的调用点都得写一遍
 * `as unknown as z.ZodArray<z.ZodTypeAny>`。断言集中到这一处：需要 element
 * 的地方很多，但「绕开泛型不变性」这件事只应有唯一事实来源。
 */
function zodArrayElement(schema: z.ZodArray): z.ZodTypeAny {
  return (schema as unknown as { element: z.ZodTypeAny }).element;
}

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

/**
 * 「逐元素恢复失败」哨兵。
 *
 * 恢复结果的类型是 `T`，而 `T` 本身可能是任意值（含 `undefined`），用返回值本身
 * 表达「没恢复出来」会让「恢复出默认值」与「恢复失败」不可区分。
 */
const RECOVERY_FAILED = Symbol('recovery-failed');

interface DataRepositoryOptions {
  /** 存储不可用时告警。 */
  onUnavailable?: () => void;
  /**
   * 本分区的 read-modify-write 跨页锁名（锁名全集见 `crossPageLock.ts`）。
   *
   * 仅供「逐元素恢复」的隐式回写使用：`read()` 语义只读，那次回写却是一次整表写，
   * 锁外执行会让期间另一上下文写入的合法数据被整表覆盖（last-writer-wins 且无痕迹）。
   *
   * 未配锁的键（如 `seeded`）维持锁外回写：它们的写入方单一，且没有对应的 RMW 锁名，
   * 套一把不存在的锁只会制造假的安全感。
   */
  rmwLock?: string;
}

/**
 * 单个存储键的读写仓库：读出时经 zod 校验，坏数据隔离为默认值而非抛给调用方。
 * 键不存在、存储不可用、校验失败三种情况统一落回 `defaultValue`（默认值的深拷贝）。
 */
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

  /**
   * 数组类数据的逐元素恢复（丢弃坏元素 → 隔离原件 → 回写干净数据）。
   *
   * 回写必须**在锁内基于重读结果**执行：`read()` 语义只读，这次回写却是一次整表写，
   * 基于锁外旧快照写回会让期间另一上下文写入的合法数据被整表覆盖
   * （last-writer-wins，且诊断里毫无痕迹）。删除几个坏元素远没有「丢掉别人刚写入的
   * 数据」严重，故重读结果已是合法值时直接交回，本次不写。
   *
   * 返回 `RECOVERY_FAILED` 表示恢复不出合法数组（调用方按整块坏数据处置）。
   */
  private async recoverElements(
    raw: readonly unknown[],
    element: z.ZodTypeAny
  ): Promise<T | typeof RECOVERY_FAILED> {
    const lock = this.options.rmwLock;
    if (lock === undefined) return this.recoverFrom(raw, element);
    return withCrossPageLock(lock, async () => {
      const area = browser.storage?.local;
      if (!area) return this.recoverFrom(raw, element);
      const fresh = (await area.get(this.key))[this.key];
      // 键已被删除：回写等于复活一份用户已丢弃的数据。
      if (fresh === undefined) return this.cloneDefault();
      // 他人已写入合法新值：直接交回，本次不做任何写（覆盖它就是静默丢数据）。
      const reparsed = this.schema.safeParse(fresh);
      if (reparsed.success) return reparsed.data;
      return Array.isArray(fresh)
        ? this.recoverFrom(fresh, element)
        : // 重读到的是非数组的坏值：交回外层，由它按原快照整块隔离。
          RECOVERY_FAILED;
    });
  }

  /** 从给定数组恢复（丢弃坏元素 → 隔离原件 → 回写）。调用方负责锁。 */
  private async recoverFrom(
    source: readonly unknown[],
    element: z.ZodTypeAny
  ): Promise<T | typeof RECOVERY_FAILED> {
    const dropped: unknown[] = [];
    const kept = source.flatMap((item) => {
      const r = element.safeParse(item);
      if (r.success) return [r.data];
      dropped.push(item);
      return [];
    });
    const reparsed = this.schema.safeParse(kept);
    if (!reparsed.success) return RECOVERY_FAILED;
    // 被丢弃的原件必须**先隔离再回写**：顺序颠倒时「回写成功 + 隔离失败」会让坏元素
    // 永久消失而诊断里零线索 —— 与 PRIVACY.md「不删除它，而是把原值移入隔离区」相反。
    if (dropped.length > 0) {
      logDegraded('storage', `${this.key} 逐元素恢复丢弃 ${dropped.length} 条坏元素`);
      await this.isolateCorrupted(dropped);
    }
    // 把恢复后的干净数据回写，避免下次仍走失败分支。
    // 回写结果必须留痕：配额接近上限时回写恒失败，此后每次读取都会重跑一遍
    // 逐元素恢复（大数组上是每次读盘都付出的固定开销），而诊断里毫无痕迹。
    const written = await this.write(reparsed.data as T);
    if (!written) {
      logDegraded('storage', `坏数据恢复后回写失败（${this.key}），下次读取将重复走恢复分支`);
    }
    return reparsed.data as T;
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
        const recovered = await this.recoverElements(raw, zodArrayElement(this.schema));
        // 恢复不成（整块仍不合法）才落到下面的整块隔离分支。
        if (recovered !== RECOVERY_FAILED) return recovered;
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
   *
   * 整段 read-modify-write 必须在 QUARANTINE_RMW_LOCK 内完成：写入方是所有分区的
   * 读取降级（每个上下文、每个键都可能触发），锁外并发时两个上下文各自基于旧列表
   * push 后互相截断对方的条目 —— 隔离区本该是「坏数据的唯一现场」，反而自己丢数据。
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
        entry.head = serialized.slice(0, QUARANTINE_HEAD_BYTES);
      }
      await withCrossPageLock(QUARANTINE_RMW_LOCK, async () => {
        const quarantine = await browser.storage.local.get(QUARANTINE_KEY);
        // 读出来的是 `unknown`：直接断言成数组再 push，一旦存进去的是非数组
        // （异常写入 / 旧版本残留），push 会在 try 里抛错把整次隔离吞掉。
        // 用 Array.isArray 收窄，非数组时从空列表重新开始（旧值本就无法追加）。
        const existing = quarantine[QUARANTINE_KEY];
        const list: unknown[] = Array.isArray(existing) ? existing : [];
        list.push(entry);
        await browser.storage.local.set({
          [QUARANTINE_KEY]: list.slice(-QUARANTINE_MAX_ENTRIES)
        });
      });
    } catch (error) {
      // 隔离失败不影响主流程
      logDegraded('storage', `坏数据隔离失败（${this.key}）`, error);
    }
  }
}

/**
 * 隔离区单条记录：校验失败的坏数据留档。
 *
 * `raw` 与 `head` 二选一：超过 `QUARANTINE_ENTRY_LIMIT` 的原文不整条留存，
 * 只保留可诊断的截断摘要（见 `isolateCorrupted`）。
 */
export interface QuarantineEntry {
  key: string;
  at: string;
  size: number;
  raw?: unknown;
  truncated?: boolean;
  head?: string;
}

/**
 * 读取隔离区内容（供设置页诊断区查看 / 导出）。
 *
 * 存储层必须提供读路径：只写不读等于把坏数据丢进黑洞——用户与排查者都无从得知
 * 「哪个键坏过、坏了什么」，而 PRIVACY.md 第 3.1-a 节对外承诺了这条出口。
 */
export async function readQuarantine(): Promise<QuarantineEntry[]> {
  try {
    const stored = await browser.storage.local.get(QUARANTINE_KEY);
    const list = stored[QUARANTINE_KEY];
    return Array.isArray(list) ? (list as QuarantineEntry[]) : [];
  } catch (error) {
    logDegraded('storage', '坏数据隔离区读取失败', error);
    return [];
  }
}

/** 清空隔离区（用户在诊断区确认留档已导出后调用）。 */
export async function clearQuarantine(): Promise<void> {
  try {
    await browser.storage.local.remove(QUARANTINE_KEY);
  } catch (error) {
    logDegraded('storage', '坏数据隔离区清理失败', error);
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
 * 写在 store 里并直连 `browser.storage` 时，新增存储分区极易漏清。
 *
 * 镜像清理以回调传入而非本模块直接依赖 SyncMirror：镜像是独立能力，由编排方
 * （store）决定「要不要清、清哪些」，仓库层不反过来依赖它。
 */
export async function clearAllStoredData(clearMirror: () => Promise<void>): Promise<void> {
  await clearMirror();
  await browser.storage.local.clear();
  await browser.storage.session.clear();
  clearThemeMirror();
}

/**
 * 扩展页 `localStorage` 里的主题镜像键。
 *
 * 与 `platform/theme/ThemeApplier` 写入的镜像键是同一组（PRIVACY.md §3.1-d 承诺
 * 「随扩展数据一并清除」）。放在 platform 层而不是 UI 层：清除拓扑（有哪些存储面、
 * 按什么顺序清）只应有一处知道，与上面的两个 `clear()` 同理由。
 */
const THEME_MIRROR_KEYS = ['tabs:theme', 'tabs:theme-hue'] as const;

/**
 * 清掉主题镜像（首屏防闪用的页面级镜像）。
 *
 * 漏清的可见后果：用户在设置页点了「清除所有数据」，刷新后首帧仍按旧主题渲染 ——
 * 数据已清空而外观没变，「是否真的清干净了」无法自证。
 *
 * 守卫 `window`：本函数也从 background SW 上下文被调用，那里没有 `window`
 * （读 `localStorage` 即 ReferenceError），SW 侧本就没有这份镜像，跳过即可。
 * 取 `window.localStorage` 而非裸 `localStorage`：后者在 Node 侧另有同名全局，
 * 在模拟环境里可能指向不可用的实现。
 */
function clearThemeMirror(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of THEME_MIRROR_KEYS) window.localStorage.removeItem(key);
  } catch {
    // 页面级存储不可用时仅影响防闪烁首帧，不阻断「清除所有数据」的主流程。
  }
}
