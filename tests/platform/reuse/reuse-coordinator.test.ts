import { describe, expect, it } from 'vitest';
import { ReuseCoordinator } from '@/platform/reuse/ReuseCoordinator';
import { AllowanceLedger } from '@/platform/reuse/AllowanceLedger';
import type { TabRecord } from '@/core/tab-types';

function makeTab(partial: Partial<TabRecord>): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  };
}

interface Harness {
  coordinator: ReuseCoordinator;
  calls: { activate: number[]; close: number[]; notifications: number };
  windowTabs: TabRecord[];
  setWindowTabs: (tabs: TabRecord[]) => void;
  flush: () => Promise<void>;
}

function createHarness(options: { allowances?: AllowanceLedger } = {}): Harness {
  const calls = { activate: [] as number[], close: [] as number[], notifications: 0 };
  let windowTabs: TabRecord[] = [];
  let pending: Promise<void> = Promise.resolve();

  const coordinator = new ReuseCoordinator(
    {
      scanWindow: async () => windowTabs,
      activate: async (tabId) => {
        calls.activate.push(tabId);
      },
      close: async (tabId) => {
        calls.close.push(tabId);
      },
      notifyReuse: () => {
        calls.notifications += 1;
      }
    },
    options
  );

  // 事件驱动路径为微任务调度；测试以 flush 等待 drain 完成。
  const flush = () => {
    // drain 在 Promise.resolve 链上运行，多轮微任务后完成
    pending = pending.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
    return pending;
  };

  return { coordinator, calls, windowTabs, setWindowTabs: (tabs) => (windowTabs = tabs), flush };
}

/**
 * 行为规格（PRD 附录 C-6/C-7）：
 *  - 新标签与窗口既有同址：激活既有、关闭新标签、通知 UI；
 *  - 豁免授权放行副本；
 *  - 空白起始页等待导航后判定；
 *  - 无痕标签不追踪。
 */
describe('ReuseCoordinator', () => {
  it('新标签同址既有 → 复用（激活既有 + 关闭新标签 + 通知）', async () => {
    const h = createHarness();
    h.setWindowTabs([
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://b.com/' })
    ]);
    h.coordinator.handleCreated(makeTab({ id: 10, index: 2, url: 'https://a.com/', status: 'complete' }));
    await h.flush();

    expect(h.calls.activate).toEqual([1]);
    expect(h.calls.close).toEqual([10]);
    expect(h.calls.notifications).toBe(1);
  });

  it('空白起始页等待导航；导航完成同址 → 复用', async () => {
    const h = createHarness();
    h.setWindowTabs([makeTab({ id: 1, index: 0, url: 'https://a.com/' })]);

    h.coordinator.handleCreated(makeTab({ id: 10, index: 1, url: 'about:blank' }));
    await h.flush();
    expect(h.calls.close).toEqual([]); // 等待中，未结算

    h.coordinator.handleUpdated(
      10,
      { url: true, status: true },
      makeTab({ id: 10, index: 1, url: 'https://a.com/', status: 'complete' })
    );
    await h.flush();
    expect(h.calls.close).toEqual([10]);
  });

  it('豁免授权放行副本（不合并）', async () => {
    const h = createHarness();
    h.setWindowTabs([makeTab({ id: 1, index: 0, url: 'https://a.com/' })]);
    h.coordinator.grantAllowance(1, 'https://a.com/');

    h.coordinator.handleCreated(makeTab({ id: 10, index: 1, url: 'https://a.com/', status: 'complete' }));
    await h.flush();
    expect(h.calls.close).toEqual([]);
    expect(h.calls.notifications).toBe(0);
  });

  it('无痕标签不追踪', async () => {
    const h = createHarness();
    h.setWindowTabs([makeTab({ id: 1, index: 0, url: 'https://a.com/' })]);
    h.coordinator.handleCreated(
      makeTab({ id: 10, index: 1, url: 'https://a.com/', incognito: true, status: 'complete' })
    );
    await h.flush();
    expect(h.calls.close).toEqual([]);
  });

  it('内部页导航完成即结算，不参与复用', async () => {
    const h = createHarness();
    h.setWindowTabs([makeTab({ id: 1, index: 0, url: 'chrome://extensions/' })]);
    h.coordinator.handleCreated(
      makeTab({ id: 10, index: 1, url: 'chrome://extensions/', status: 'complete' })
    );
    await h.flush();
    expect(h.calls.close).toEqual([]);
  });

  it('窗口内无同址标签 → 保留新标签', async () => {
    const h = createHarness();
    h.setWindowTabs([makeTab({ id: 1, index: 0, url: 'https://b.com/' })]);
    h.coordinator.handleCreated(makeTab({ id: 10, index: 1, url: 'https://a.com/', status: 'complete' }));
    await h.flush();
    expect(h.calls.close).toEqual([]);
  });

  it('同 URL 已有多个：保留最近访问的既有，关闭其余既有 + 新建', async () => {
    const h = createHarness();
    h.setWindowTabs([
      makeTab({ id: 1, index: 0, url: 'https://a.com/', lastAccessed: 100 }),
      makeTab({ id: 2, index: 1, url: 'https://a.com/', lastAccessed: 300 })
    ]);
    h.coordinator.handleCreated(makeTab({ id: 10, index: 2, url: 'https://a.com/', status: 'complete' }));
    await h.flush();

    expect(h.calls.activate).toEqual([2]); // 最近访问的既有标签
    expect(h.calls.close).toEqual([1, 10]); // 其余既有 + 新建全部关闭
    expect(h.calls.notifications).toBe(1);
  });

  it('开关关闭后不再追踪合并（允许同 URL 多开）', async () => {
    const h = createHarness();
    h.setWindowTabs([makeTab({ id: 1, index: 0, url: 'https://a.com/' })]);
    h.coordinator.setEnabled(false);

    h.coordinator.handleCreated(makeTab({ id: 10, index: 1, url: 'https://a.com/', status: 'complete' }));
    await h.flush();
    expect(h.calls.close).toEqual([]);
    expect(h.calls.notifications).toBe(0);

    // 重新开启后恢复追踪
    h.coordinator.setEnabled(true);
    h.coordinator.handleCreated(makeTab({ id: 11, index: 2, url: 'https://a.com/', status: 'complete' }));
    await h.flush();
    expect(h.calls.close).toEqual([11]);
  });

  it('单任务异常（标签恰被用户关闭）不中断调度，后续任务照常结算', async () => {
    const calls = { activate: [] as number[], close: [] as number[] };
    const windowTabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://b.com/' })
    ];
    const coordinator = new ReuseCoordinator({
      scanWindow: async () => windowTabs,
      activate: async (tabId) => {
        calls.activate.push(tabId);
      },
      close: async (tabId) => {
        calls.close.push(tabId);
        if (tabId === 10) throw new Error('tab already closed');
      },
      notifyReuse: () => {}
    });

    coordinator.handleCreated(makeTab({ id: 10, index: 2, url: 'https://a.com/', status: 'complete' }));
    coordinator.handleCreated(makeTab({ id: 11, index: 3, url: 'https://b.com/', status: 'complete' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 任务 10 的 close 抛错不影响任务 11 照常激活与关闭
    expect(calls.activate).toEqual([1, 2]);
    expect(calls.close).toEqual([10, 11]);
  });
});
