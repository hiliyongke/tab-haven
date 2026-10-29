import { browser } from 'wxt/browser';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import { queryWindowGroups, queryCurrentWindowTabs } from '@/platform/tabs';
import { logDegraded, logFailure } from '@/platform/diagnostics';

/**
 * 标签同步服务：把浏览器标签事件统一为「快照刷新」信号。
 *
 * 调度模型（节流 + 合并）：
 *  - signal：任何标签/分组事件（或显式请求）产生刷新信号；
 *  - 首事件立即触发查询（leading edge）；查询进行中/窗口内的后续事件仅标记 pending（合并）；
 *  - 查询结束且存在 pending 时，等待节流窗口（40ms）后再查一次（trailing）；
 *  - 每次广播带递增代数（generation），订阅方据此判断新鲜度。
 * 快照的真相源始终是浏览器（每次查询），本服务不缓存中间状态。
 */

interface TabSnapshot {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  windowId: number | undefined;
  /** 快照代数：每次广播递增。 */
  generation: number;
}

const THROTTLE_MS = 40;
/** 发声标签存在时的校准轮询间隔：Chrome 对 audible 置 false 存在秒级时滞，轮询将收敛上限压至该值。 */
const AUDIBLE_POLL_MS = 2000;
/**
 * 只有这些字段变化才需要重新查询快照。favicon 单独更新、直播/计时器类站点的高频标题刷新
 * 都会触发一次全窗口查询。favicon 刻意不在列表里：它必定与 title/url/status 之一同时变化。
 */
const RELEVANT_UPDATE_KEYS = [
  'title',
  'url',
  'pendingUrl',
  'pinned',
  'mutedInfo',
  'groupId',
  'status',
  'audible',
  'discarded',
  // TabRecord 建模了这两个字段：拆分时下载完成提醒 / 自动休眠开关变化不同步会滞留旧状态。
  'attention',
  'autoDiscardable'
] as const;
/** 连续失败时的退避倍数上限（40ms → 最长约 1.3s），避免失败场景下持续空转。 */
const MAX_BACKOFF_FACTOR = 32;
/**
 * 连续失败的重试次数上限。退避间隔封了顶但次数不封顶时，tabs.query 的确定性失败（权限被
 * 禁用、windowId 异常等）会以 ~1.3s 间隔永久轮询，很快把其它真实故障挤出诊断缓冲。
 * 用尽后停止自动重试，但不永久禁用：任何新标签事件 / 显式 requestRefresh 仍会触发一次尝试。
 */
const MAX_RETRY_ATTEMPTS = 8;

export class TabSyncService {
  private generation = 0;
  /**
   * 全部活跃 start 会话的刷新信号。必须是集合而非单值：sidepanel / options 可各自挂载一个
   * start 会话，只保留最后一个会让 requestRefresh() 打到「别人的」会话。
   */
  private readonly activeSignals = new Set<() => void>();

  /**
   * 显式请求一次快照刷新（幂等）：供「直接改写浏览器标签/组结构」的写操作完成后调用，
   * 确保 UI 立即反映，不依赖事件被派发到本上下文的时序。广播到全部活跃会话。
   */
  requestRefresh(): void {
    for (const signal of [...this.activeSignals]) signal();
  }

  start(onSnapshot: (snapshot: TabSnapshot) => void): () => void {
    // 每次 start 拥有独立的运行态闭包，互不污染：React StrictMode（开发模式）会挂载→清理→
    // 再挂载，若 stopped 是单例字段，第一次清理置 true 会让第二次监听器在 run() 内直接 return。
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let querying = false;
    /** 连续失败次数：用于 trailing 重试的指数退避。 */
    let failures = 0;
    /** 发声标签存在时的校准轮询（见 syncAudiblePolling）。 */
    let audibleTimer: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      querying = true;
      try {
        // 先查标签再带 windowId 查组：省掉 queryWindowGroups 内部那次只为拿 windowId 的重复查询。
        const tabs = await queryCurrentWindowTabs();
        const groups = await queryWindowGroups(tabs[0]?.windowId);
        if (stopped) return;
        failures = 0;
        // 依据最新快照启停「发声校准轮询」（先于广播，让 onSnapshot 立即获得最新值）。
        syncAudiblePolling(tabs);
        this.generation += 1;
        try {
          onSnapshot({ tabs, groups, windowId: tabs[0]?.windowId, generation: this.generation });
        } catch (error) {
          // 订阅方渲染回调异常不是查询失败：若与查询同处一个 try，会被计入 failures 并按
          // 指数退避反复重试。单独捕获留痕，不污染退避状态。
          logDegraded('tab-sync', '快照订阅方处理异常', error);
        }
      } catch (error) {
        failures += 1;
        // 必须进诊断导出：查询持续失败时面板会静默停在旧数据上，无从排查。
        logDegraded('tab-sync', '标签快照刷新失败', error);
        if (failures === MAX_RETRY_ATTEMPTS) {
          // 熔断必须显式告知：否则「面板一直停在旧数据」会被当成偶发卡顿。
          logFailure(
            'tab-sync',
            `标签快照刷新连续失败 ${MAX_RETRY_ATTEMPTS} 次，已停止自动重试（标签事件/手动刷新仍会重试）`
          );
        }
      } finally {
        querying = false;
        // stopped 时不得再排新的 timer。失败时即使无 pending 也排兜底重试（指数退避）：
        // 否则浏览器启动早期打开面板撞上瞬时失败，会停在空态直到下一次标签事件。重试次数封顶。
        if (!stopped && (pending || (failures > 0 && failures < MAX_RETRY_ATTEMPTS))) {
          pending = false;
          const factor = failures > 0 ? Math.min(2 ** failures, MAX_BACKOFF_FACTOR) : 1;
          timer = setTimeout(() => {
            timer = null;
            void run();
          }, THROTTLE_MS * factor);
        }
      }
    };

    const signal = () => {
      if (timer || querying) {
        pending = true;
        return;
      }
      void run();
    };

    /**
     * 发声校准轮询（仅当窗口存在 audible 标签时启用，2s 间隔）。页面停止发声后，Chrome 对
     * tabs.Tab.audible 的置 false 与 onUpdated 派发存在可达秒级的内部时滞。扩展没有比事件更快
     * 的信号，纯事件驱动会让「暂停后绿点迟迟不消失」的时长不可预期。这里用低频轮询把收敛上限
     * 压到 ~2s：有发声标签才轮询，静止即自动停表，无播放场景零开销。
     */
    const syncAudiblePolling = (tabs: readonly TabRecord[]) => {
      const hasAudible = tabs.some((tab) => tab.audible);
      if (hasAudible && audibleTimer === null) {
        audibleTimer = setInterval(() => signal(), AUDIBLE_POLL_MS);
      } else if (!hasAudible && audibleTimer !== null) {
        clearInterval(audibleTimer);
        audibleTimer = null;
      }
    };

    const events: Array<{
      addListener: (cb: () => void) => void;
      removeListener: (cb: () => void) => void;
    }> = [
      browser.tabs.onCreated,
      browser.tabs.onRemoved,
      browser.tabs.onActivated,
      browser.tabs.onMoved,
      browser.tabs.onAttached,
      browser.tabs.onDetached
    ];
    // onReplaced 并非全平台可用（Firefox 无此事件）：不加守卫直接 addListener 会抛错导致整个 start() 失败。
    if (browser.tabs.onReplaced) events.push(browser.tabs.onReplaced);
    // onUpdated 带 changeInfo，单独注册以便按字段过滤（见 RELEVANT_UPDATE_KEYS）。
    const onUpdated = (_tabId: number, changeInfo?: object): void => {
      // 拿不到 changeInfo 时按「可能需要刷新」处理：宁可多查一次，也不要漏更新。
      if (changeInfo && !RELEVANT_UPDATE_KEYS.some((key) => key in changeInfo)) return;
      signal();
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    if (browser.tabGroups) {
      events.push(
        browser.tabGroups.onCreated,
        browser.tabGroups.onUpdated,
        browser.tabGroups.onMoved,
        browser.tabGroups.onRemoved
      );
    }
    for (const event of events) {
      event.addListener(signal);
    }

    // 启动即刷新一次（首帧数据）。
    this.activeSignals.add(signal);
    signal();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (audibleTimer !== null) clearInterval(audibleTimer);
      this.activeSignals.delete(signal);
      browser.tabs.onUpdated.removeListener(onUpdated);
      for (const event of events) {
        event.removeListener(signal);
      }
    };
  }
}

/** 标签镜像 store 复用的单例同步服务（start 可多页面各自挂载/清理）。 */
export const tabSyncService = new TabSyncService();
