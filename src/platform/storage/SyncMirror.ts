import { browser } from 'wxt/browser';
import { z } from 'zod';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 跨设备同步镜像：
 * 借力浏览器账号同步通道（chrome.storage.sync），产品不经手任何数据。
 *
 * 模型：local 为主、sync 为镜像。
 *  - 本地数据每次落盘后，把固定文件夹 + 固定图标 + 设置镜像到 sync（分块存储，防 8KB/项 配额）；
 *  - 新设备首次安装（无 seeded 标志）时从镜像拉取恢复；
 *  - 超出 sync 配额时静默降级（仅丢失镜像，本地数据不受影响）。
 *
 * 同步范围：设置 + 固定集合。归档/快照等大数据不镜像。
 */

const CHUNK_PREFIX = 'tabs.sync.v1.';
const CHUNK_META_KEY = `${CHUNK_PREFIX}meta`;
/** 单块安全字节数（chrome.storage.sync 单 key 配额 8KB，按 UTF-8 字节计——
    中文标题/URL 每字符 3 字节，按字符数切分必超配额）。 */
const CHUNK_BYTES = 6000;
const MIRROR_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 镜像 30 天无更新视为过期

/** 镜像内容 schema（不校验设置细节，交给 SettingsSchema 在读取端校验）。 */
const MirrorPayloadSchema = z.object({
  at: z.number(),
  folders: z.array(z.unknown()),
  pins: z.array(z.unknown()),
  settings: z.record(z.string(), z.unknown())
});
type MirrorPayload = z.infer<typeof MirrorPayloadSchema>;

export interface MirrorData {
  folders: unknown[];
  pins: unknown[];
  settings: Record<string, unknown>;
}

class SyncMirror {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 去抖窗口内最新的待写数据（后写覆盖先写，保证最终落盘的是最新状态）。 */
  private pendingPayload: MirrorData | undefined;
  /** 写失败重试定时器与已试次数（sync 分钟级写配额需要时间恢复，必须退避）。 */
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempts = 0;
  private static readonly MAX_RETRY_ATTEMPTS = 5;
  private unloadFlushBound = false;
  /**
   * 写操作串行链：write 是「get 全部 → remove 过期块 → set 新块」的非原子三步，
   * pagehide 立即 flush 与 500ms 去抖定时器（或重试定时器）的写可能在途并发，
   * 两个写各自 get 后交错落盘会让旧 payload 覆盖新 payload（镜像整体回滚）。
   * 全部 write 收口到本链后，同一时刻至多一个写在途，顺序确定。
   */
  private writeChain: Promise<void> = Promise.resolve();

  /**
   * 丢弃去抖窗口内尚未落盘的镜像与待重试任务。
   *
   * 必须在「关闭同步」「清除所有数据」前调用：否则清完 sync 之后 timer 触发，
   * 会把刚删掉的数据重新写回浏览器账号通道 —— 「关闭即删除已上传数据」的
   * 承诺会被一次 500ms 竞态击穿。
   */
  cancelPending(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.retryAttempts = 0;
    this.pendingPayload = undefined;
  }

  /** 调度一次镜像写入（合并高频写入，500ms 后落盘）。 */
  schedule(payload: MirrorData): void {
    this.pendingPayload = payload;
    this.bindUnloadFlush();
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const latest = this.pendingPayload;
      this.pendingPayload = undefined;
      if (latest) void this.write(latest);
    }, 500);
  }

  /**
   * 页面卸载时把去抖窗口内的待写镜像立即落盘（best-effort）。
   * 否则面板在 500ms 去抖窗口内关闭时，这段镜像静默丢失（仅影响镜像新鲜度）。
   */
  private bindUnloadFlush(): void {
    if (this.unloadFlushBound || typeof window === 'undefined') return;
    this.unloadFlushBound = true;
    window.addEventListener('pagehide', () => {
      const latest = this.pendingPayload;
      if (!latest) return;
      this.cancelPending();
      void this.write(latest);
    });
  }

  /** 失败后指数退避重试（30s 起，×2 递增，上限 5 次）：立即重试只会持续撞分钟级写配额。 */
  private scheduleRetry(payload: MirrorData): void {
    if (this.retryAttempts >= SyncMirror.MAX_RETRY_ATTEMPTS) return;
    this.retryAttempts += 1;
    // 已有待重试任务时以最新 payload 替换（与 pendingPayload 的末值语义一致），
    // 否则旧数据会在新数据写入成功后复活，镜像回滚。
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    const delay = 30_000 * 2 ** (this.retryAttempts - 1);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.write(payload);
    }, delay);
  }

  /** 立即写入镜像（分块 + 清理过期块）。经写串行链执行，防并发写交错回滚。 */
  write(payload: MirrorData): Promise<void> {
    const run = this.writeChain.then(() => this.performWrite(payload));
    this.writeChain = run.catch(() => {});
    return run;
  }

  /** write 的实际执行体（串行链内运行）。 */
  private async performWrite(payload: MirrorData): Promise<void> {
    const area = browser.storage?.sync;
    if (!area) return;
    try {
      const json = JSON.stringify({
        at: Date.now(),
        folders: payload.folders,
        pins: payload.pins,
        settings: payload.settings
      } satisfies MirrorPayload);
      // 按 UTF-8 字节数切分（sync 配额按字节计）；for..of 按码点迭代，
      // 不会切断代理对，块内任意位置 decode 均安全。
      const encoder = new TextEncoder();
      const chunks: string[] = [];
      let current = '';
      let currentBytes = 0;
      for (const char of json) {
        const charBytes = encoder.encode(char).length;
        if (currentBytes + charBytes > CHUNK_BYTES && current) {
          chunks.push(current);
          current = '';
          currentBytes = 0;
        }
        current += char;
        currentBytes += charBytes;
      }
      if (current) chunks.push(current);
      const record: Record<string, string> = {
        [CHUNK_META_KEY]: JSON.stringify({ count: chunks.length })
      };
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (chunk === undefined) break;
        record[`${CHUNK_PREFIX}${i}`] = chunk;
      }
      // 清理上次残留的更多块（分块数只减不增时无残留，此处兜底）。
      // 批量 remove：逐个 remove 每次都计一次 sync 分钟级写配额（120 次/分）。
      const all = await area.get(null);
      const staleKeys = Object.keys(all).filter(
        (key) => key.startsWith(CHUNK_PREFIX) && !(key in record)
      );
      if (staleKeys.length > 0) await area.remove(staleKeys);
      await area.set(record);
      // 成功后复位重试计数并撤销待重试任务：否则旧 payload 的重试定时器
      // 会在本次新数据落盘后再次触发，把镜像回滚为旧数据。
      this.retryAttempts = 0;
      if (this.retryTimer !== undefined) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
    } catch (error) {
      // 超出同步配额或同步不可用：降级（仅丢失镜像，本地数据不受影响）。
      // 但必须可观测——否则「跨设备同步悄悄失效」对用户完全不可见。
      logDegraded('sync-mirror', '镜像写入失败，跨设备同步已降级（本地数据不受影响）', error);
      this.scheduleRetry(payload);
    }
  }

  /** 清除全部镜像（「关闭同步」「清除所有数据」时调用：防止下次初始化时旧镜像回灌本地）。 */
  async clearAll(): Promise<void> {
    // 先撤销待写：顺序颠倒会让去抖窗口内的旧数据在清除之后落盘，云端数据复活。
    this.cancelPending();
    const area = browser.storage?.sync;
    if (!area) return;
    try {
      const all = await area.get(null);
      const keys = Object.keys(all).filter((key) => key.startsWith(CHUNK_PREFIX));
      if (keys.length > 0) await area.remove(keys);
    } catch (error) {
      logDegraded('sync-mirror', '镜像清除失败', error);
    }
  }

  /** 读取镜像（不存在 / 损坏 / 过期返回 null）。 */
  async pull(): Promise<MirrorData | null> {
    const area = browser.storage?.sync;
    if (!area) return null;
    try {
      const all = await area.get(null);
      const metaRaw = all[CHUNK_META_KEY];
      if (typeof metaRaw !== 'string') return null;
      const meta = JSON.parse(metaRaw) as { count?: number };
      if (typeof meta.count !== 'number' || meta.count <= 0 || meta.count > 64) return null;
      const chunks: string[] = [];
      for (let i = 0; i < meta.count; i += 1) {
        const chunk = all[`${CHUNK_PREFIX}${i}`];
        if (typeof chunk !== 'string') return null;
        chunks.push(chunk);
      }
      const parsed = MirrorPayloadSchema.safeParse(JSON.parse(chunks.join('')));
      if (!parsed.success) return null;
      if (Date.now() - parsed.data.at > MIRROR_TTL_MS) return null;
      return {
        folders: parsed.data.folders,
        pins: parsed.data.pins,
        settings: parsed.data.settings
      };
    } catch (error) {
      // 镜像损坏 / 过期返回 null 是正常分支（上面已处理）；走到这里是解析异常，
      // 需要留痕以便区分「从未同步过」与「镜像坏了」。
      logDegraded('sync-mirror', '镜像读取失败，跳过本次恢复', error);
      return null;
    }
  }
}

/** 全局单例：dataStore 与导入流程共用。 */
export const syncMirror = new SyncMirror();
