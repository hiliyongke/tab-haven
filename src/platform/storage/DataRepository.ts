import { browser } from 'wxt/browser';
import type { ZodType } from 'zod';

/**
 * 数据仓库：单 key 的读写 + 校验 + 变更订阅（chrome.storage.local 通道）。
 *
 * 读写管线（docs/ARCHITECTURE.md 5.1）：
 *  - 写入：schema.parse 通过后落盘；
 *  - 读取：safeParse 失败 → 坏数据隔离（写入隔离区供诊断）+ 返回默认值；
 *  - 订阅：storage.onChanged 过滤本 key，解析后回调。
 *
 * 存储不可用（权限被策略禁用）时降级为内存态（写入静默跳过并告警回调）。
 */

export interface DataRepositoryOptions {
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

      // 坏数据隔离：不扩散、可诊断
      await this.isolateCorrupted(raw);
      return this.defaultValue;
    } catch (error) {
      console.error(`[DataRepository] read failed for ${this.key}`, error);
      this.options.onUnavailable?.();
      return this.defaultValue;
    }
  }

  async write(value: T): Promise<void> {
    const area = browser.storage?.local;
    if (!area) {
      this.options.onUnavailable?.();
      return;
    }
    try {
      await area.set({ [this.key]: this.schema.parse(value) });
    } catch (error) {
      console.error(`[DataRepository] write failed for ${this.key}`, error);
      this.options.onUnavailable?.();
    }
  }

  /** 订阅本 key 的变更（其他页面/背景写入时同步）。 */
  watch(onChange: (value: T) => void): () => void {
    const listener = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string
    ) => {
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
      const quarantine = await browser.storage.local.get('tabhaven.quarantine');
      const list = (quarantine['tabhaven.quarantine'] as unknown[]) || [];
      list.push({ key: this.key, raw, at: new Date().toISOString() });
      await browser.storage.local.set({ 'tabhaven.quarantine': list.slice(-20) });
    } catch {
      // 隔离失败不影响主流程
    }
  }
}
