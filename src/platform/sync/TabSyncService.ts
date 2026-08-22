import { browser } from 'wxt/browser';
import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import { queryCurrentWindowGroups, queryCurrentWindowTabs } from '@/platform/tabs';

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

export interface TabSnapshot {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  windowId: number | undefined;
  /** 快照代数：每次广播递增。 */
  generation: number;
}

const THROTTLE_MS = 40;

export class TabSyncService {
  private generation = 0;
  private stopped = false;

  start(onSnapshot: (snapshot: TabSnapshot) => void): () => void {
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let querying = false;

    const run = async () => {
      querying = true;
      try {
        const [tabs, groups] = await Promise.all([
          queryCurrentWindowTabs(),
          queryCurrentWindowGroups()
        ]);
        if (this.stopped) return;
        this.generation += 1;
        onSnapshot({ tabs, groups, windowId: tabs[0]?.windowId, generation: this.generation });
      } catch (error) {
        console.error(error);
      } finally {
        querying = false;
        if (pending) {
          pending = false;
          timer = setTimeout(() => {
            timer = null;
            void run();
          }, THROTTLE_MS);
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

    const events: Array<{ addListener: (cb: () => void) => void; removeListener: (cb: () => void) => void }> = [
      browser.tabs.onCreated,
      browser.tabs.onRemoved,
      browser.tabs.onUpdated,
      browser.tabs.onActivated,
      browser.tabs.onMoved,
      browser.tabs.onAttached,
      browser.tabs.onDetached,
      browser.tabs.onReplaced
    ];
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
      this.stopped = true;
      if (timer) clearTimeout(timer);
      for (const event of events) {
        event.removeListener(signal);
      }
    };
  }
}
