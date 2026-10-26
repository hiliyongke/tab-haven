import { browser } from 'wxt/browser';
import { z } from 'zod';
import { createSerialChain } from '@/core/util/concurrency';
import { logDegraded } from '@/platform/diagnostics';
import { t } from '@/i18n/headless';

/**
 * 跨设备同步镜像：
 * 借力浏览器账号同步通道（chrome.storage.sync），产品不经手任何数据。
 *
 * 模型：local 为主、sync 为镜像。
 *  - 本地数据每次落盘后，把固定文件夹 + 固定图标 + 设置镜像到 sync（分块存储，防 8KB/项 配额）；
 *  - 新设备首次安装（无 seeded 标志）时从镜像拉取恢复；
 *  - 超出 sync 配额时静默降级（仅丢失镜像，本地数据不受影响）。
 *
 * 同步范围：设置 + 文件夹 + 常驻磁贴（pins）。归档/快照等大数据不镜像。
 *
 * 注：磁贴也在镜像范围内 —— 对外文案（设置项说明、PRIVACY.md、SECURITY.md）
 * 必须与之保持一致，否则会出现「说明书少写了已上传的数据」。
 */

const CHUNK_PREFIX = 'tabs.sync.v1.';
const CHUNK_META_KEY = `${CHUNK_PREFIX}meta`;
/** 单块安全字节数（chrome.storage.sync 单 key 配额 8KB，按 UTF-8 字节计——
    中文标题/URL 每字符 3 字节，按字符数切分必超配额）。 */
const CHUNK_BYTES = 6000;
/** chrome.storage.sync 总配额（QUOTA_BYTES，字节）：按字节计，超出后 set 直接抛错。 */
const QUOTA_BYTES = 102_400;
/**
 * 分块数上限：与总配额对齐（100KB ÷ 6000B ≈ 17 块）。
 *
 * 取 64 会远超配额可达上限：set 在到达 64 块之前就因配额抛错，`pull()` 的
 * 'chunk-limit' 分支永远不可达，设置页的「超出同步容量上限」也就永远不会亮。
 * 对齐为配额内的可达块数后，超限才是一档能被识别的状态
 * （超限必须留痕，不能与「无镜像」同款静默）。
 */
const MAX_CHUNKS = Math.floor(QUOTA_BYTES / CHUNK_BYTES);
/**
 * 容量预检留出的安全边距（字节）。
 *
 * chrome.storage.sync 的 QUOTA_BYTES 计 **key + value**，不是只算 value：17 个块键
 * （`tabs.sync.v1.N`，各约 16 字节）加 meta 约 300 字节。只按 JSON 字节判定的话，
 * 数据贴着 100KB 时 set 仍会抛 QUOTA_BYTES，而这次失败会被当成普通写失败走退避
 * 重试 —— 容量超限是**确定性**的，重试只会白白消耗分钟级写配额（120 次/分）。
 */
const QUOTA_MARGIN_BYTES = 512;
const MIRROR_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 镜像 30 天无更新视为过期
/**
 * 镜像写失败的重试基数：sync 的写配额是分钟级的（MAX_WRITE_OPERATIONS_PER_MINUTE），
 * 立刻重试只会持续撞墙，因此第 1 次就等 30s，其后按 ×2 递增。
 */
const RETRY_BASE_DELAY_MS = 30_000;
/** 镜像去抖窗口：本地数据高频落盘时合并为一次 sync 写（sync 有分钟级写配额）。 */
const MIRROR_DEBOUNCE_MS = 500;

/** 镜像内容 schema（不校验设置细节，交给 SettingsSchema 在读取端校验）。 */
const MirrorPayloadSchema = z.object({
  at: z.number(),
  folders: z.array(z.unknown()),
  pins: z.array(z.unknown()),
  settings: z.record(z.string(), z.unknown())
});
type MirrorPayload = z.infer<typeof MirrorPayloadSchema>;

interface MirrorData {
  folders: unknown[];
  pins: unknown[];
  settings: Record<string, unknown>;
}

/**
 * `pull()` 的结果分类。
 *
 * 拉取返回 null 有四种成因：「从未同步过」「分块数超出浏览器同步配额」
 * 「镜像损坏 / 过期」「解析异常」。只有第一种是正常态，其余都是「本该有镜像
 * 却拿不到」——统一返回 null 会让调用方无从区分，设置页也就无法告诉用户
 * 「同步其实没生效」。
 */
/**
 * 同步状态的成因分类。
 *
 * 前四类是 `pull()` 自己的结果；`local` 由初始化切片合成——本地已有数据时
 * 以本地为准、本轮**没有**从镜像恢复任何东西，此时沿用 `pull()` 给的 'ok'
 * 会让设置页显示「已生效」，而用户关心的是「换机能不能恢复」。
 */
export type MirrorSyncIssue = 'ok' | 'none' | 'chunk-limit' | 'unreadable' | 'local';

/**
 * 镜像写失败的成因。
 *
 * `quota` 是**确定性**的（数据本身就超过浏览器同步配额，重试无意义），
 * `write` 是暂时性的（配额/通道瞬时不可用，退避重试有机会成功）。
 * PRIVACY.md §4 要求配额超限显示「未生效（超出同步容量上限）」，与「本次改动未上传」
 * 是两档不同的呈现 —— 走通用失败回调时用户看到的是后者，与文档口径不符。
 */
export type MirrorWriteFailureReason = 'quota' | 'write';

class SyncMirror {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 去抖窗口内最新的待写数据（后写覆盖先写，保证最终落盘的是最新状态）。 */
  private pendingPayload: MirrorData | undefined;
  /** 写失败重试定时器与已试次数（sync 分钟级写配额需要时间恢复，必须退避）。 */
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempts = 0;
  private static readonly MAX_RETRY_ATTEMPTS = 5;
  private unloadFlushBound = false;
  /** `pagehide` 监听器的引用（`dispose()` 解绑用；匿名函数无法 remove）。 */
  private unloadFlushHandler?: () => void;
  /**
   * 写操作串行链：write 是「get 全部 → remove 过期块 → set 新块」的非原子三步，
   * pagehide 立即 flush 与 500ms 去抖定时器（或重试定时器）的写可能在途并发，
   * 两个写各自 get 后交错落盘会让旧 payload 覆盖新 payload（镜像整体回滚）。
   * 全部 write 收口到本链后，同一时刻至多一个写在途，顺序确定。
   */
  private writeChain = createSerialChain();
  /**
   * 镜像写结果的回执。
   *
   * 镜像失败只进诊断日志是不够的 —— 诊断日志只有主动导出才看得到，「跨设备同步
   * 悄悄失效」对用户完全不可见（用户以为开着同步，实际上其他设备收不到改动）。
   * platform 层不做 UI 反馈，只把结果交出去，由组合根（dataStore）转成可见提示。
   */
  private onFailure: ((message: string, reason: MirrorWriteFailureReason) => void) | undefined;
  private onSuccess: (() => void) | undefined;
  /** 最近一次 `pull()` 的结果分类：让「镜像不可用」可被 UI 呈现。 */
  private lastPullIssue: MirrorSyncIssue = 'none';

  /** 注册镜像写结果的回执回调（幂等覆盖：最后注册者生效）。 */
  setMirrorResultHandlers(handlers: {
    onFailure: (message: string, reason: MirrorWriteFailureReason) => void;
    onSuccess: () => void;
  }): void {
    this.onFailure = handlers.onFailure;
    this.onSuccess = handlers.onSuccess;
  }

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
    }, MIRROR_DEBOUNCE_MS);
  }

  /**
   * 页面卸载时把去抖窗口内的待写镜像立即落盘（best-effort）。
   * 否则面板在 500ms 去抖窗口内关闭时，这段镜像静默丢失（仅影响镜像新鲜度）。
   */
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
   * 释放本实例持有的全局资源（`pagehide` 监听 + 待写/重试定时器）。
   *
   * 监听器此前从不解绑：单例与页面同生命周期时无感，但测试与「实例被替换」的
   * 场景下旧实例的监听会继续触发 `write()`，把已作废的 payload 写回浏览器账号
   * 通道——正是 `cancelPending()` 想防的那类「旧数据复活」。
   *
   * 解绑后允许重新绑定（`unloadFlushBound` 复位），使 dispose 之后实例仍可用。
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
    // 已有待重试任务时以最新 payload 替换（与 pendingPayload 的末值语义一致），
    // 否则旧数据会在新数据写入成功后复活，镜像回滚。
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    const delay = RETRY_BASE_DELAY_MS * 2 ** (this.retryAttempts - 1);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.write(payload);
    }, delay);
  }

  /** 立即写入镜像（分块 + 清理过期块）。经写串行链执行，防并发写交错回滚。 */
  write(payload: MirrorData): Promise<void> {
    return this.writeChain.enqueue(() => this.performWrite(payload));
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
      const encoder = new TextEncoder();
      // 容量预检：sync 的硬上限是**总字节**（QUOTA_BYTES 100KB），不是块数。
      // 不做预检的话，超限只会在 set 抛错时才暴露（那之前块数远不到 MAX_CHUNKS），
      // 于是它只会被当成一次普通的「写失败」，'chunk-limit' 分支永远走不到，
      // 设置页的「超出同步容量上限」永远不会亮。这里提前判定并留痕。
      //
      // 两个条件缺一不可：写侧按字节放行、读侧按块数判定，两把尺子一旦错位，
      // 102000 < total ≤ 102400 时会切出 18 块并写入成功，而 pull 判定
      // 18 > MAX_CHUNKS 直接判超限返回 null —— 镜像「写进去了却永远读不出来」，
      // 换机时新设备拿到 null，还会把本地空态推上云覆盖掉这份镜像。
      const totalBytes = encoder.encode(json).length;
      const chunkCount = Math.ceil(totalBytes / CHUNK_BYTES);
      if (totalBytes + QUOTA_MARGIN_BYTES > QUOTA_BYTES || chunkCount > MAX_CHUNKS) {
        // 刻意**不**改 lastPullIssue：那是 pull 的分类（「镜像读不读得出来」），
        // 写结果由 onFailure 交给组合根落成 mirrorWriteFailed，两件事分列呈现。
        // 混用一个字段会让「本次改动没上传」被显示成「镜像损坏」之类的读侧结论。
        logDegraded(
          'sync-mirror',
          `镜像超出同步配额（${totalBytes}/${QUOTA_BYTES} 字节，${chunkCount}/${MAX_CHUNKS} 块），已跳过本次镜像`
        );
        // reason='quota'：与「暂时写不上去」区分开，让设置页能按 PRIVACY.md §4
        // 显示「未生效（超出同步容量上限）」，而不是「本次改动未上传」。
        this.onFailure?.(
          t('跨设备同步镜像写入失败：本地数据不受影响，但其它设备不会收到本次改动'),
          'quota'
        );
        // 容量超限是确定性的：重试只会反复撞配额并消耗分钟级写配额（120 次/分）。
        return;
      }
      // 按 UTF-8 字节数切分（sync 配额按字节计）；for..of 按码点迭代，
      // 不会切断代理对，块内任意位置 decode 均安全。
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
      // 先 set 后 remove：顺序颠倒时 set 失败会留下半截镜像（旧尾部块已删、新块未写），
      // 他设备 pull() 读到「meta 声明 N 块而块不全」会被判 unreadable —— 明明只是
      // 一次写失败，却被显示成「镜像损坏」。旧块在 set 之后残留只是多占配额，
      // 不影响按 meta 声明的块数读取。
      await area.set(record);
      if (staleKeys.length > 0) {
        // remove 失败单独留痕：它是清理动作，不能把一次成功的镜像写报成失败。
        await area.remove(staleKeys).catch((error) => {
          logDegraded('sync-mirror', '镜像过期块清理失败（不影响本次镜像读取）', error);
        });
      }
      // 成功后复位重试计数并撤销待重试任务：否则旧 payload 的重试定时器
      // 会在本次新数据落盘后再次触发，把镜像回滚为旧数据。
      this.retryAttempts = 0;
      if (this.retryTimer !== undefined) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
      this.onSuccess?.();
    } catch (error) {
      // 超出同步配额或同步不可用：降级（仅丢失镜像，本地数据不受影响）。
      // 但必须可观测——否则「跨设备同步悄悄失效」对用户完全不可见。
      logDegraded('sync-mirror', '镜像写入失败，跨设备同步已降级（本地数据不受影响）', error);
      this.onFailure?.(
        t('跨设备同步镜像写入失败：本地数据不受影响，但其它设备不会收到本次改动'),
        'write'
      );
      this.scheduleRetry(payload);
    }
  }

  /**
   * 读取最近一次 `pull()` 的结果分类。
   *
   * 调用方（initSlice / mirrorRestore）据此把「镜像不可用」呈现给用户：
   * 返回 null 只说明「这次没拿到数据」，为什么没拿到只有这里知道。
   */
  readLastPullIssue(): MirrorSyncIssue {
    return this.lastPullIssue;
  }

  /** 清除全部镜像（「关闭同步」「清除所有数据」时调用：防止下次初始化时旧镜像回灌本地）。 */
  async clearAll(): Promise<void> {
    // 先撤销待写：顺序颠倒会让去抖窗口内的旧数据在清除之后落盘，云端数据复活。
    this.cancelPending();
    // 挂到写串行链尾部：在途 performWrite 是 get→remove→set 非原子三步，clearAll
    // 若与之并发，在途写的 set 会落在清除之后，让刚删掉的镜像复活。
    return this.writeChain.enqueue(() => this.performClear());
  }

  /** clearAll 的实际执行体（串行链内运行）。 */
  private async performClear(): Promise<void> {
    // 链内再撤一次待写/重试：排在本清除之前的在途写若失败，其 catch 会在
    // cancelPending（链头）之后才同步排入 retryTimer——不在此处补撤，
    // 30s 后旧 payload 会被重试写回，「关闭即删除已上传数据」被击穿。
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

  /**
   * 读取镜像（不存在 / 损坏 / 过期返回 null）。
   *
   * 与 write / clearAll 一样挂到写串行链尾部：performWrite 是「get → remove → set」
   * 的非原子三步，跨上下文（设置页 / 侧边栏）的 pull 若落在 remove 与 set 之间，
   * 会读到「meta 声明 N 块 + 块已不在」的组合而被判 unreadable；pull 只在 init /
   * 开启同步时跑一次，这一次误判会粘住整个会话（表现为「同步未生效」）。
   */
  async pull(): Promise<MirrorData | null> {
    return this.writeChain.enqueue(() => this.performPull());
  }

  /** pull 的实际执行体（串行链内运行）。 */
  private async performPull(): Promise<MirrorData | null> {
    this.lastPullIssue = 'none';
    const area = browser.storage?.sync;
    if (!area) {
      // 同步区不可用（被企业策略禁用等）不是「从未同步过」：用户开了同步，
      // 却因为通道不存在而拿不到镜像。归为「本该有却拿不到」一档，
      // 让设置页显示「未生效」而不是「尚未生成镜像」。
      this.lastPullIssue = 'unreadable';
      return null;
    }
    try {
      const all = await area.get(null);
      const metaRaw = all[CHUNK_META_KEY];
      // 没有 meta 才是「从未同步过」：保持 'none'。meta 存在但读不出 count
      // 说明镜像已损坏，必须与「从未同步过」区分开，否则设置页会显示「已生效」。
      if (typeof metaRaw !== 'string') return null;
      const meta = JSON.parse(metaRaw) as { count?: number };
      if (typeof meta.count !== 'number' || meta.count <= 0) {
        this.lastPullIssue = 'unreadable';
        return null;
      }
      if (meta.count > MAX_CHUNKS) {
        // 分块数超限不是「没有镜像」，而是「镜像不可用」：与『无镜像』同样
        // 静默返回 null，用户换机后恢复不到数据却看不到任何提示。留痕以便
        // 设置页据此提示「同步镜像未生效（容量超限）」。
        this.lastPullIssue = 'chunk-limit';
        logDegraded(
          'sync-mirror',
          `同步镜像分块数超限（${meta.count}/${MAX_CHUNKS}），已跳过本次恢复`
        );
        return null;
      }
      const chunks: string[] = [];
      for (let i = 0; i < meta.count; i += 1) {
        const chunk = all[`${CHUNK_PREFIX}${i}`];
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
      // 镜像损坏 / 过期返回 null 是正常分支（上面已处理）；走到这里是解析异常，
      // 需要留痕以便区分「从未同步过」与「镜像坏了」。
      this.lastPullIssue = 'unreadable';
      logDegraded('sync-mirror', '镜像读取失败，跳过本次恢复', error);
      return null;
    }
  }
}

/** 全局单例：dataStore 与导入流程共用。 */
export const syncMirror = new SyncMirror();
