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
  'discarded'
] as const;
/** 连续失败时的退避倍数上限（40ms → 最长约 1.3s），避免失败场景下持续空转。 */
const MAX_BACKOFF_FACTOR = 32;

export class TabSyncService {
  private generation = 0;

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

    const run = async () => {
      querying = true;
      try {
        const [tabs, groups] = await Promise.all([
          queryCurrentWindowTabs(),
          queryCurrentWindowGroups()
        ]);
        if (stopped) return;
        failures = 0;
        this.generation += 1;
        onSnapshot({ tabs, groups, windowId: tabs[0]?.windowId, generation: this.generation });
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

    const events: Array<{
      addListener: (cb: () => void) => void;
      removeListener: (cb: () => void) => void;
    }> = [
      browser.tabs.onCreated,
      browser.tabs.onRemoved,
      browser.tabs.onActivated,
      browser.tabs.onMoved,
      browser.tabs.onAttached,
      browser.tabs.onDetached,
      browser.tabs.onReplaced
    ];
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
    signal();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      for (const event of events) {
        event.removeListener(signal);
      }
    };
  }
}
