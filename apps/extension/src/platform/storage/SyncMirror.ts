import { browser } from 'wxt/browser';
import { z } from 'zod';
import { createSerialChain } from '@/core/util/concurrency';
import { logDegraded } from '@/platform/diagnostics';
import { t } from '@/i18n/headless';
import { SYNC_MIRROR_LOCK, withCrossPageLock } from '@/platform/storage/crossPageLock';

/**
 * 跨设备同步镜像：借浏览器账号同步通道（chrome.storage.sync），产品不经手数据。
 * 模型：local 为主、sync 为镜像 —— 本地每次落盘后把文件夹 + 图标 + 设置 + pins 分块镜像到
 * sync（防 8KB/项 配额）；新设备首启（无 seeded）从镜像恢复；超配额时静默降级（仅丢镜像）。
 * 归档/快照等大数据不镜像。磁贴也在镜像范围内，对外文案（设置项说明、PRIVACY.md 等）须与此一致。
 */

const CHUNK_PREFIX = 'tabs.sync.v1.';
const CHUNK_META_KEY = `${CHUNK_PREFIX}meta`;
/** 单块安全字节数：sync 单 key 配额 8KB 按字节计（中文标题/URL 每字符 3 字节，按字符切分必超配额）。 */
const CHUNK_BYTES = 6000;
/** chrome.storage.sync 总配额（字节）：按字节计，超出后 set 直接抛错。 */
const QUOTA_BYTES = 102_400;
/**
 * 分块数上限：与总配额对齐（100KB ÷ 6000B ≈ 17 块）。
 * 取远超配额可达块数的值会让 set 在到达上限前就抛错，pull 的 'chunk-limit' 分支永远不可达，
 * 设置页的「超出同步容量上限」也就永远不会亮 —— 超限必须是一档能被识别的可达状态。
 */
const MAX_CHUNKS = Math.floor(QUOTA_BYTES / CHUNK_BYTES);
/**
 * 容量预检留出的安全边距（字节）。
 * QUOTA_BYTES 计 key + value（17 个块键 + meta 约 300 字节），只按 JSON 字节判定的话，
 * 数据贴着 100KB 时 set 仍会抛 QUOTA_BYTES，而这次失败会被当成普通写失败走退避重试 ——
 * 容量超限是确定性的，重试只会白耗分钟级写配额（120 次/分）。
 */
const QUOTA_MARGIN_BYTES = 512;
const MIRROR_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 镜像 30 天无更新视为过期
/** 镜像写失败的重试基数：sync 写配额是分钟级的，立即重试只会撞墙，故第 1 次等 30s，其后 ×2 递增。 */
const RETRY_BASE_DELAY_MS = 30_000;
/** 镜像去抖窗口：合并高频落盘为一次 sync 写（sync 有分钟级写配额）。 */
const MIRROR_DEBOUNCE_MS = 500;

/** 镜像内容 schema（不校验设置细节，交给 SettingsSchema 在读取端校验）。 */
const MirrorPayloadSchema = z.object({
  at: z.number(),
  folders: z.array(z.unknown()),
  pins: z.array(z.unknown()),
  settings: z.record(z.string(), z.unknown())
});
type MirrorPayload = z.infer<typeof MirrorPayloadSchema>;

/** meta 最后切换；generation 让每次写入使用独立块，跨上下文交错也不会互相覆盖。 */
const MirrorMetaSchema = z.object({
  count: z.number().int().positive(),
  generation: z.string().min(1).optional()
});
type MirrorMeta = z.infer<typeof MirrorMetaSchema>;

function parseMirrorMeta(raw: unknown): MirrorMeta | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = MirrorMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function generationChunkKey(generation: string, index: number): string {
  return `${CHUNK_PREFIX}${generation}.${index}`;
}

function isLegacyChunkKey(key: string): boolean {
  return key.startsWith(CHUNK_PREFIX) && /^\d+$/.test(key.slice(CHUNK_PREFIX.length));
}

interface MirrorData {
  folders: unknown[];
  pins: unknown[];
  settings: Record<string, unknown>;
}

/**
 * 同步状态的成因分类。
 * 前四类是 pull() 的结果（区分「从未同步过」与「本该有镜像却拿不到」）；local 由初始化切片合成 ——
 * 本地已有数据且初始化未从镜像恢复时，应标记为 local，避免设置页误报「已生效」。
 */
export type MirrorSyncIssue = 'ok' | 'none' | 'chunk-limit' | 'unreadable' | 'local';

/** 镜像写失败成因：quota 是确定性（数据超配额，重试无意义），write 是暂时性（退避重试有机会成功）。 */
export type MirrorWriteFailureReason = 'quota' | 'write';

class SyncMirror {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 去抖窗口内最新的待写数据（后写覆盖先写，保证最终落盘最新状态）。 */
  private pendingPayload: MirrorData | undefined;
  /** 写失败重试定时器与已试次数（sync 分钟级写配额需时间恢复，必须退避）。 */
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempts = 0;
  private static readonly MAX_RETRY_ATTEMPTS = 5;
  private unloadFlushBound = false;
  /** pagehide 监听器引用（dispose 解绑用；匿名函数无法 remove）。 */
  private unloadFlushHandler?: () => void;
  /**
   * 写操作串行链：write 是「get 全部 → remove 过期块 → set 新块」的非原子三步，
   * pagehide 立即 flush 与去抖/重试定时器的写可能在途并发，两个写各自 get 后交错落盘会
   * 让旧 payload 覆盖新 payload。全部 write 收口到本链后，同一时刻至多一个写在途。
   */
  private writeChain = createSerialChain();
  /** 镜像写结果回执：把失败/成功交给组合根（dataStore）转成可见提示，platform 层不做 UI。 */
  private onFailure: ((message: string, reason: MirrorWriteFailureReason) => void) | undefined;
  private onSuccess: (() => void) | undefined;
  /** 最近一次 pull() 的结果分类：让「镜像不可用」可被 UI 呈现。 */
  private lastPullIssue: MirrorSyncIssue = 'none';

  /** 注册镜像写结果回执回调（幂等覆盖：最后注册者生效）。 */
  setMirrorResultHandlers(handlers: {
    onFailure: (message: string, reason: MirrorWriteFailureReason) => void;
    onSuccess: () => void;
  }): void {
    this.onFailure = handlers.onFailure;
    this.onSuccess = handlers.onSuccess;
  }

  /**
   * 丢弃去抖窗口内尚未落盘的镜像与待重试任务。
   * 须在「关闭同步」「清除所有数据」前调用：否则清完 sync 后 timer 触发，
   * 会把刚删掉的数据写回浏览器账号通道。
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
    }, MIRROR_DEBOUNCE_MS);
  }

  /** 页面卸载时把去抖窗口内待写镜像立即落盘（best-effort）：否则面板在窗口内关闭时这段镜像静默丢失。 */
  private bindUnloadFlush(): void {
    if (this.unloadFlushBound || typeof window === 'undefined') return;
    this.unloadFlushBound = true;
    // 具名保存监听器引用：匿名函数无法 removeEventListener，实例被丢弃后监听仍常驻。
    this.unloadFlushHandler = () => {
      const latest = this.pendingPayload;
      if (!latest) return;
      this.cancelPending();
      void this.write(latest);
    };
    window.addEventListener('pagehide', this.unloadFlushHandler);
  }

  /**
   * 释放全局资源（pagehide 监听 + 待写/重试定时器）。
   * 监听器不解绑时，测试与「实例被替换」场景下旧实例的监听会继续触发 write，
   * 把已作废的 payload 写回浏览器账号通道。解绑后复位 unloadFlushBound，使 dispose 之后实例仍可用。
   */
  dispose(): void {
    this.cancelPending();
    if (this.unloadFlushHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.unloadFlushHandler);
    }
    this.unloadFlushHandler = undefined;
    this.unloadFlushBound = false;
  }

  /** 失败后指数退避重试（30s 起，×2 递增，上限 5 次）：立即重试只会持续撞分钟级写配额。 */
  private scheduleRetry(payload: MirrorData): void {
    if (this.retryAttempts >= SyncMirror.MAX_RETRY_ATTEMPTS) return;
    this.retryAttempts += 1;
    // 已有待重试任务时以最新 payload 替换，否则旧数据会在新数据写入成功后复活，镜像回滚。
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    const delay = RETRY_BASE_DELAY_MS * 2 ** (this.retryAttempts - 1);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.write(payload);
    }, delay);
  }

  /** 立即写入镜像（分块 + 清理过期块）。经写串行链执行，防并发写交错回滚。 */
  write(payload: MirrorData): Promise<void> {
    return this.writeChain.enqueue(() =>
      withCrossPageLock(SYNC_MIRROR_LOCK, () => this.performWrite(payload))
    );
  }

  /** write 的实际执行体（串行链内运行）。 */
  private async performWrite(payload: MirrorData): Promise<void> {
    const area = browser.storage?.sync;
    if (!area) return;
    let uncommittedChunkKeys: string[] = [];
    try {
      const json = JSON.stringify({
        at: Date.now(),
        folders: payload.folders,
        pins: payload.pins,
        settings: payload.settings
      } satisfies MirrorPayload);
      const encoder = new TextEncoder();
      // 容量预检：sync 硬上限是总字节（QUOTA_BYTES 100KB），不是块数。不预检的话超限
      // 只在 set 抛错时才暴露，被当成普通「写失败」，'chunk-limit' 分支永远走不到。
      // 两个条件缺一不可：写侧按字节放行、读侧按块数判定，两把尺子错位会让 102000 < total ≤ 102400
      // 切出 18 块并写入成功，而 pull 判超限返回 null —— 镜像写进去了却永远读不出来。
      const totalBytes = encoder.encode(json).length;
      const chunkCount = Math.ceil(totalBytes / CHUNK_BYTES);
      if (totalBytes + QUOTA_MARGIN_BYTES > QUOTA_BYTES || chunkCount > MAX_CHUNKS) {
        // 不改 lastPullIssue：那是 pull 的分类，写结果由 onFailure 交给组合根，两件事分列呈现。
        logDegraded(
          'sync-mirror',
          `镜像超出同步配额（${totalBytes}/${QUOTA_BYTES} 字节，${chunkCount}/${MAX_CHUNKS} 块），已跳过本次镜像`
        );
        // reason='quota'：与「暂时写不上去」区分，让设置页按 PRIVACY.md §4 显示「超出同步容量上限」。
        this.onFailure?.(
          t('跨设备同步镜像写入失败：本地数据不受影响，但其它设备不会收到本次改动'),
          'quota'
        );
        // 容量超限是确定性的：重试只会反复撞配额并消耗分钟级写配额。
        return;
      }
      // 按 UTF-8 字节数切分；for..of 按码点迭代，不会切断代理对，块内任意位置 decode 均安全。
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
      const generation = crypto.randomUUID();
      const record: Record<string, string> = {};
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (chunk === undefined) break;
        record[generationChunkKey(generation, i)] = chunk;
      }
      uncommittedChunkKeys = Object.keys(record);
      const all = await area.get(null);
      const previousMeta = parseMirrorMeta(all[CHUNK_META_KEY]);
      // 新块完整落盘后才切换 meta。即使另一上下文不支持 Web Locks，读侧也只会看到
      // 「旧 meta + 旧完整块」或「新 meta + 新完整块」，不会读到本次写入的半截状态。
      await area.set(record);
      await area.set({
        [CHUNK_META_KEY]: JSON.stringify({ count: chunks.length, generation } satisfies MirrorMeta)
      });
      uncommittedChunkKeys = [];
      // 只清理切换前的旧 generation 与历史固定块。其它 generation 可能正被另一上下文
      // 写入但尚未切 meta，不能把它们误判为残留删掉；失败写入的孤儿块由 clearAll 全清。
      const previousPrefix = previousMeta?.generation
        ? `${CHUNK_PREFIX}${previousMeta.generation}.`
        : undefined;
      const staleKeys = Object.keys(all).filter(
        (key) =>
          isLegacyChunkKey(key) || (previousPrefix !== undefined && key.startsWith(previousPrefix))
      );
      if (staleKeys.length > 0) {
        // remove 失败单独留痕：它是清理动作，不能把一次成功的镜像写报成失败。
        await area.remove(staleKeys).catch((error) => {
          logDegraded('sync-mirror', '镜像过期块清理失败（不影响本次镜像读取）', error);
        });
      }
      // 成功后复位重试计数并撤销待重试任务：否则旧 payload 的重试会在本次落盘后再次触发，镜像回滚。
      this.retryAttempts = 0;
      if (this.retryTimer !== undefined) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
      this.onSuccess?.();
    } catch (error) {
      // 未提交块只属于本次 generation，可安全回收，避免多次写失败耗尽 sync 总配额。
      if (uncommittedChunkKeys.length > 0) {
        await area.remove(uncommittedChunkKeys).catch((cleanupError) => {
          logDegraded('sync-mirror', '镜像未提交块清理失败', cleanupError);
        });
      }
      // 超出同步配额或同步不可用：降级（仅丢失镜像，本地数据不受影响），但必须可观测。
      logDegraded('sync-mirror', '镜像写入失败，跨设备同步已降级（本地数据不受影响）', error);
      this.onFailure?.(
        t('跨设备同步镜像写入失败：本地数据不受影响，但其它设备不会收到本次改动'),
        'write'
      );
      this.scheduleRetry(payload);
    }
  }

  /** 读取最近一次 pull() 的结果分类：调用方据此把「镜像不可用」呈现给用户。 */
  readLastPullIssue(): MirrorSyncIssue {
    return this.lastPullIssue;
  }

  /** 清除全部镜像（「关闭同步」「清除所有数据」时调用：防止下次初始化时旧镜像回灌本地）。 */
  async clearAll(): Promise<void> {
    // 先撤销待写：顺序颠倒会让去抖窗口内的旧数据在清除之后落盘，云端数据复活。
    this.cancelPending();
    // 挂到写串行链尾部：在途 performWrite 是 get→remove→set 非原子三步，clearAll 若与之并发，
    // 在途写的 set 会落在清除之后，让刚删掉的镜像复活。
    return this.writeChain.enqueue(() =>
      withCrossPageLock(SYNC_MIRROR_LOCK, () => this.performClear())
    );
  }

  /** clearAll 的实际执行体（串行链内运行）。 */
  private async performClear(): Promise<void> {
    // 链内再撤一次：排在本清除之前的在途写若失败，其 catch 会在链头 cancelPending 之后
    // 才排入 retryTimer —— 不在此处补撤，30s 后旧 payload 会被重试写回。
    this.cancelPending();
    const area = browser.storage?.sync;
    if (!area) return;
    try {
      const all = await area.get(null);
      const keys = Object.keys(all).filter((key) => key.startsWith(CHUNK_PREFIX));
      if (keys.length > 0) await area.remove(keys);
    } catch (error) {
      logDegraded('sync-mirror', '镜像清除失败', error);
      // 调用方必须停止后续本地清理：否则 sync 镜像仍在，下次启动会把已清数据回灌。
      throw error;
    }
  }

  /**
   * 读取镜像（不存在 / 损坏 / 过期返回 null）。
   * 与 write / clearAll 一样挂到写串行链尾部：performWrite 是「get → remove → set」非原子三步，
   * 跨上下文的 pull 若落在 remove 与 set 之间，会读到「meta 声明 N 块 + 块已不在」而被判 unreadable；
   * pull 只在 init / 开启同步时跑一次，这一次误判会粘住整个会话。
   */
  async pull(): Promise<MirrorData | null> {
    return this.writeChain.enqueue(() =>
      withCrossPageLock(SYNC_MIRROR_LOCK, () => this.performPull())
    );
  }

  /** pull 的实际执行体（串行链内运行）。 */
  private async performPull(): Promise<MirrorData | null> {
    this.lastPullIssue = 'none';
    const area = browser.storage?.sync;
    if (!area) {
      // 同步区不可用（被企业策略禁用等）不是「从未同步过」：归为「本该有却拿不到」，显示「未生效」。
      this.lastPullIssue = 'unreadable';
      return null;
    }
    try {
      const all = await area.get(null);
      const metaRaw = all[CHUNK_META_KEY];
      // 没有 meta 才是「从未同步过」：保持 none。meta 存在但读不出 count 说明镜像已损坏，须与从未同步过区分。
      if (typeof metaRaw !== 'string') return null;
      const meta = parseMirrorMeta(metaRaw);
      if (!meta) {
        this.lastPullIssue = 'unreadable';
        return null;
      }
      if (meta.count > MAX_CHUNKS) {
        // 分块数超限不是「没有镜像」而是「镜像不可用」：留痕以便设置页提示容量超限。
        this.lastPullIssue = 'chunk-limit';
        logDegraded(
          'sync-mirror',
          `同步镜像分块数超限（${meta.count}/${MAX_CHUNKS}），已跳过本次恢复`
        );
        return null;
      }
      const chunks: string[] = [];
      for (let i = 0; i < meta.count; i += 1) {
        const key = meta.generation
          ? generationChunkKey(meta.generation, i)
          : `${CHUNK_PREFIX}${i}`;
        const chunk = all[key];
        // 缺块 = 镜像不完整（同步被配额截断或写入中途失败），属「本该有却拿不到」。
        if (typeof chunk !== 'string') {
          this.lastPullIssue = 'unreadable';
          return null;
        }
        chunks.push(chunk);
      }
      const parsed = MirrorPayloadSchema.safeParse(JSON.parse(chunks.join('')));
      // 结构不符与过期同属「镜像不可用」：留痕后返回 null，由调用方呈现。
      if (!parsed.success) {
        this.lastPullIssue = 'unreadable';
        return null;
      }
      if (Date.now() - parsed.data.at > MIRROR_TTL_MS) {
        this.lastPullIssue = 'unreadable';
        logDegraded('sync-mirror', '同步镜像已过期（超过 30 天未更新），已跳过本次恢复');
        return null;
      }
      this.lastPullIssue = 'ok';
      return {
        folders: parsed.data.folders,
        pins: parsed.data.pins,
        settings: parsed.data.settings
      };
    } catch (error) {
      // 走到这里是解析异常，需留痕以区分「从未同步过」与「镜像坏了」。
      this.lastPullIssue = 'unreadable';
      logDegraded('sync-mirror', '镜像读取失败，跳过本次恢复', error);
      return null;
    }
  }
}

/** 全局单例：dataStore 与导入流程共用。 */
export const syncMirror = new SyncMirror();
