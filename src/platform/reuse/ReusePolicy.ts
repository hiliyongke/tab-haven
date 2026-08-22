import type { TabRecord } from '@/core/tab-types';
import { rankForKeep } from '@/core/dup/DedupeByUrl';
import { inspectUrl } from '@/core/url/UrlInspector';

/**
 * 复用决策：给定新标签与窗口标签快照，决定是否复用既有标签。
 *
 * 行为规格（PRD 附录 C-6 / 同 URL 唯一化）：新标签与窗口内既有标签共享同一
 * 比较键（网址）时，激活既有标签并关闭新标签。保留者偏好统一走
 * core/dup/DedupeByUrl 的 rankForKeep（最近访问 > 激活 > 固定 > 位置靠前 > id 大）：
 *  1. 优先复用"既有"标签（非本次新建的）；
 *  2. 无既有标签时，本次同时新建的同址标签中排序靠前者胜出。
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

    const target = rankForKeep(pool);
    if (!target || target.id === newTab.id) return { kind: 'standalone' };
    return { kind: 'reuse', targetId: target.id };
  }
}
