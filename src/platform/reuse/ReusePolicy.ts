import type { TabRecord } from '@/core/tab-types';
import { inspectUrl } from '@/core/url/UrlInspector';

/**
 * 复用决策：给定新标签与窗口标签快照，决定是否复用既有标签。
 *
 * 行为规格（PRD 附录 C-6）：新标签与窗口内既有标签共享同一比较键（网址）时，
 * 激活既有标签并关闭新标签。候选偏好与两级策略：
 *  1. 优先复用"既有"标签（非本次新建的）；其中偏好激活 > 固定 > 位置靠前 > id 小；
 *  2. 无既有标签时，本次同时新建的同址标签中 id 最小者胜出。
 */

export type ReuseDecision =
  | { kind: 'reuse'; targetId: number }
  | { kind: 'standalone' };

export class ReusePolicy {
  /**
   * @param newTab 新打开的标签
   * @param windowTabs 同一窗口的标签快照
   * @param newlyOpenedTabIds 本次会话中新打开的标签 id 集合（运行态追踪）
   */
  decide(
    newTab: TabRecord,
    windowTabs: readonly TabRecord[],
    newlyOpenedTabIds: ReadonlySet<number>
  ): ReuseDecision {
    const inspection = inspectUrl(newTab.url, newTab.pendingUrl);
    if (inspection.category !== 'web') return { kind: 'standalone' };

    const candidates = windowTabs.filter((candidate) => {
      if (candidate.id === newTab.id) return false;
      const candidateInspection = inspectUrl(candidate.url, candidate.pendingUrl);
      return (
        candidateInspection.category === 'web' &&
        candidateInspection.comparisonKey === inspection.comparisonKey
      );
    });
    if (candidates.length === 0) return { kind: 'standalone' };

    const established = candidates.filter((candidate) => !newlyOpenedTabIds.has(candidate.id));
    const pool = established.length > 0 ? established : candidates;

    const target = this.rankByPreference(pool);
    if (!target || target.id === newTab.id) return { kind: 'standalone' };
    return { kind: 'reuse', targetId: target.id };
  }

  /** 偏好排序：激活 > 固定 > 位置靠前 > id 小。 */
  private rankByPreference(tabs: readonly TabRecord[]): TabRecord | undefined {
    return [...tabs].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.index !== b.index) return a.index - b.index;
      return a.id - b.id;
    })[0];
  }
}
