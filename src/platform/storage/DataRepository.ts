import { browser } from 'wxt/browser';
import { z, type ZodType } from 'zod';

/**
 * 数据仓库：单 key 的读写 + 校验 + 变更订阅（chrome.storage.local 通道）。
 *
 * 读写管线（docs/ARCHITECTURE.md 5.1）：
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
      console.error(`[DataRepository] read failed for ${this.key}`, error);
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
      console.error(`[DataRepository] write failed for ${this.key}`, error);
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
        onChange(this.defaultValue);
        return;
      }
      const parsed = this.schema.safeParse(change.newValue);
      if (parsed.success) onChange(parsed.data);
    };
    browser.storage?.onChanged?.addListener(listener);
    return () => browser.storage?.onChanged?.removeListener(listener);
  }

  get keyName(): string {
    return this.key;
  }

  private async isolateCorrupted(raw: unknown): Promise<void> {
    try {
      const quarantine = await browser.storage.local.get('tabs.quarantine');
      const list = (quarantine['tabs.quarantine'] as unknown[]) || [];
      list.push({ key: this.key, raw, at: new Date().toISOString() });
      await browser.storage.local.set({ 'tabs.quarantine': list.slice(-20) });
    } catch (error) {
      // 隔离失败不影响主流程
      console.warn(`[DataRepository] quarantine failed for ${this.key}`, error);
    }
  }
}
