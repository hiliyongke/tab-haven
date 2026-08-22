import { describe, expect, it } from 'vitest';
import { ReusePolicy } from '@/platform/reuse/ReusePolicy';
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

const policy = new ReusePolicy();

/**
 * 行为规格（PRD 附录 C-6 / 同 URL 唯一化）：
 *  - 同网址新标签复用窗口内既有标签：激活既有、关闭新标签由协调器执行；
 *  - 复用目标偏好：最近访问 > 激活 > 固定 > 位置靠前 > id 大（rankForKeep 统一口径）；
 *  - 既有标签（非本次新建）优先；无既有时本次新建中排序靠前者胜出；
 *  - 非 web 页、无匹配候选时保持独立。
 */
describe('ReusePolicy', () => {
  it('同网址既有标签被选为复用目标', () => {
    const newTab = makeTab({ id: 10, index: 2, url: 'https://a.com/' });
    const windowTabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://b.com/' })
    ];
    const decision = policy.decide(newTab, windowTabs, new Set([10]));
    expect(decision.kind).toBe('reuse');
    if (decision.kind === 'reuse') expect(decision.targetId).toBe(1);
  });

  it('偏好排序：最近访问 > 激活 > 固定 > 位置 > id', () => {
    const newTab = makeTab({ id: 10, index: 4, url: 'https://a.com/' });
    const windowTabs = [
      // lastAccessed 最新者胜出
      makeTab({ id: 30, index: 0, url: 'https://a.com/', pinned: true, lastAccessed: 100 }),
      makeTab({ id: 20, index: 2, url: 'https://a.com/', active: true, lastAccessed: 200 })
    ];
    const decision = policy.decide(newTab, windowTabs, new Set([10]));
    expect(decision).toEqual({ kind: 'reuse', targetId: 20 });
  });

  it('无 lastAccessed 时回退：激活 > 固定 > 位置 > id', () => {
    const newTab = makeTab({ id: 10, index: 3, url: 'https://a.com/' });
    const windowTabs = [
      makeTab({ id: 30, index: 0, url: 'https://a.com/', pinned: true }),
      makeTab({ id: 20, index: 2, url: 'https://a.com/', active: true })
    ];
    const decision = policy.decide(newTab, windowTabs, new Set([10]));
    expect(decision).toEqual({ kind: 'reuse', targetId: 20 });
  });

  it('既有标签优先于本次新建（established 优先）', () => {
    const newTab = makeTab({ id: 10, index: 3, url: 'https://a.com/' });
    const windowTabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 7, index: 1, url: 'https://a.com/', active: true })
    ];
    // 7 是本次新建（tracked），1 是既有；既有优先
    const decision = policy.decide(newTab, windowTabs, new Set([7, 10]));
    expect(decision).toEqual({ kind: 'reuse', targetId: 1 });
  });

  it('无既有标签时：本次新建中 id 最小者胜出', () => {
    const newTab = makeTab({ id: 10, index: 3, url: 'https://a.com/' });
    const windowTabs = [
      makeTab({ id: 5, index: 1, url: 'https://a.com/', active: true }),
      makeTab({ id: 9, index: 2, url: 'https://a.com/' })
    ];
    const decision = policy.decide(newTab, windowTabs, new Set([5, 9, 10]));
    expect(decision).toEqual({ kind: 'reuse', targetId: 5 });
  });

  it('候选仅为自身时保持独立', () => {
    const newTab = makeTab({ id: 10, index: 1, url: 'https://a.com/' });
    const windowTabs = [makeTab({ id: 10, index: 1, url: 'https://a.com/' })];
    const decision = policy.decide(newTab, windowTabs, new Set([10]));
    expect(decision.kind).toBe('standalone');
  });

  it('无同网址候选时保持独立', () => {
    const newTab = makeTab({ id: 10, index: 1, url: 'https://a.com/' });
    const windowTabs = [makeTab({ id: 1, index: 0, url: 'https://b.com/' })];
    expect(policy.decide(newTab, windowTabs, new Set([10])).kind).toBe('standalone');
  });

  it('导航中（pending 同址）同样判定为重复', () => {
    const newTab = makeTab({ id: 10, index: 2, url: 'about:blank', pendingUrl: 'https://a.com/' });
    const windowTabs = [makeTab({ id: 1, index: 0, url: 'https://a.com/' })];
    expect(policy.decide(newTab, windowTabs, new Set([10]))).toEqual({
      kind: 'reuse',
      targetId: 1
    });
  });

  it('内部页不参与复用', () => {
    const newTab = makeTab({ id: 10, index: 2, url: 'chrome://newtab/' });
    const windowTabs = [makeTab({ id: 1, index: 0, url: 'chrome://newtab/' })];
    expect(policy.decide(newTab, windowTabs, new Set([10])).kind).toBe('standalone');
  });
});
