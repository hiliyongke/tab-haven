import { browser } from 'wxt/browser';
import { z, type ZodType } from 'zod';
import { logDegraded } from '@/platform/diagnostics';

/** 隔离区单条原始数据的体积上限（超出只留摘要，避免撑爆 local 配额）。 */
const QUARANTINE_ENTRY_LIMIT = 32 * 1024;

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

  async read(): Promise<T> {
    const area = browser.storage?.local;
    if (!area) {
      this.options.onUnavailable?.();
      return this.defaultValue;
    }
    try {
      const stored = await area.get(this.key);
      const raw = stored[this.key];
      if (raw === undefined) return this.defaultValue;
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
          void this.write(reparsed.data as T);
          return reparsed.data as T;
        }
      }

      // 坏数据隔离：不扩散、可诊断
      await this.isolateCorrupted(raw);
      return this.defaultValue;
    } catch (error) {
      logDegraded('storage', `数据读取失败（${this.key}）`, error);
      this.options.onUnavailable?.();
      return this.defaultValue;
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
        // 经 schema 重解析出一份深拷贝：直接传 defaultValue 引用会让订阅方
        // 拿到仓库持有的同一对象，将来任一订阅方原地修改数组即污染默认值。
        onChange(this.schema.parse(this.defaultValue));
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
