import { browser } from 'wxt/browser';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import { queryCurrentWindowGroups, queryCurrentWindowTabs } from '@/platform/tabs';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 标签同步服务：把浏览器标签事件统一为"快照刷新"信号。
 *
 * 调度模型（全新设计，节流 + 合并）：
 *  - signal：任何标签/分组事件（或显式请求）产生刷新信号；
 *  - 首事件立即触发查询（leading edge）；
 *  - 查询进行中/窗口内的后续事件仅标记 pending（合并，避免事件风暴）；
 *  - 查询结束且存在 pending 时，等待节流窗口（40ms）后再查一次（trailing）；
 *  - 每次广播带递增代数（generation），订阅方据此判断新鲜度。
 *
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
/** 发声标签存在时的校准轮询间隔：Chrome 对 audible 置 false 存在秒级时滞，轮询将其收敛上限压至该值。 */
const AUDIBLE_POLL_MS = 2000;
/**
 * 只有这些字段变化才需要重新查询快照。
 *
 * `tabs.onUpdated` 不过滤的话，favicon 单独更新、直播/计时器类站点的高频标题
 * 刷新都会触发一次全窗口查询 —— 一个不断改标题的页面能让扩展持续空转。
 * favicon 刻意不在列表里：它必定与 title/url/status 之一同时变化。
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

export class TabSyncService {
  private generation = 0;
  /** 当前活跃 start 会话的刷新信号（由 start 注册、cleanup 注销）。 */
  private activeSignal: (() => void) | null = null;

  /**
   * 显式请求一次快照刷新（幂等）：供「直接改写浏览器标签/组结构」的写操作
   * （如固定文件夹转原生组）完成后调用，确保 UI 立即反映，不依赖
   * tabs/tabGroups 事件被派发到本上下文的时序（事件驱动的 refresh 照常生效，
   * 两者经 signal 的 querying/timer 合并机制天然去重，不会重复查询）。
   */
  requestRefresh(): void {
    this.activeSignal?.();
  }

  start(onSnapshot: (snapshot: TabSnapshot) => void): () => void {
    // 每次 start 拥有独立的运行态闭包，互不污染：
    // React StrictMode（开发模式）会挂载→清理→再挂载，若 stopped 是单例字段，
    // 第一次清理置 true 会让第二次（真正生效的）监听器在 run() 内直接 return，
    // 表现为"侧边栏首帧后不再响应任何 tab 变化"。改为局部变量即可根治。
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
        // 先查标签再带 windowId 查组：省掉 queryCurrentWindowGroups 内部那次
        // 只为拿 windowId 的重复全窗口查询（每次刷新 3 次 API 调用降为 2 次）。
        const tabs = await queryCurrentWindowTabs();
        const groups = await queryCurrentWindowGroups(tabs[0]?.windowId);
        if (stopped) return;
        failures = 0;
        // 依据最新快照启停「发声校准轮询」（先于广播，让 onSnapshot 立即获得最新值）。
        syncAudiblePolling(tabs);
        this.generation += 1;
        try {
          onSnapshot({ tabs, groups, windowId: tabs[0]?.windowId, generation: this.generation });
        } catch (error) {
          // 订阅方渲染回调异常不是查询失败：若与查询同处一个 try，会被计入
          // failures 并按指数退避反复重试，形成「错误来源在订阅方、却按查询
          // 失败空转」的循环。单独捕获留痕，不污染退避状态。
          logDegraded('tab-sync', '快照订阅方处理异常', error);
        }
      } catch (error) {
        failures += 1;
        // 必须进诊断导出：查询持续失败时面板会静默停在旧数据上，无从排查。
        logDegraded('tab-sync', '标签快照刷新失败', error);
      } finally {
        querying = false;
        // stopped 时不得再排新的 timer：清理已跑完却仍挂上定时器，
        // 会在 stop 之后发起一次无人接收的孤儿查询。
        if (pending && !stopped) {
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
     * 发声校准轮询（仅当窗口存在 audible 标签时启用，2s 间隔）。
     *
     * 根因：页面停止发声后，Chrome 对 tabs.Tab.audible 的置 false 与
     * `tabs.onUpdated(changeInfo.audible)` 派发存在可达秒级的内部时滞（与网页是否
     * 释放 AudioContext 相关）。扩展没有比事件更快的信号，但纯事件驱动会让
     * 「暂停后绿点/播放提示迟迟不消失」的时长完全不可预期。这里用低频轮询把
     * 收敛上限压到 ~2s：有发声标签才轮询，静止（无 audible）即自动停表，无播放
     * 场景零开销。事件正常时轮询经 signal 合并机制几乎不产生额外查询。
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
    // onReplaced 并非全平台可用（Firefox 无此事件）：不加守卫直接 addListener
    // 会抛错导致整个 start() 失败、同步完全失效。
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
    this.activeSignal = signal;
    signal();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (audibleTimer !== null) clearInterval(audibleTimer);
      if (this.activeSignal === signal) this.activeSignal = null;
      browser.tabs.onUpdated.removeListener(onUpdated);
      for (const event of events) {
        event.removeListener(signal);
      }
    };
  }
}

/** 标签镜像 store 复用的单例同步服务（start 可多页面各自挂载/清理）。 */
export const tabSyncService = new TabSyncService();
