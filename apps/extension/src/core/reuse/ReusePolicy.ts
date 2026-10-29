import type { TabRecord } from '@/core/tab-types';
import { rankForKeep } from '@/core/dup/DedupeByUrl';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 复用决策：新标签与窗口内既有标签同网址时，激活既有标签并关闭新标签。
 * 保留者统一走 rankForKeep：优先复用既有标签；无既有标签时，本次同址新建标签中排序靠前者胜出。
 */

type ReuseDecision = { kind: 'reuse'; targetId: number } | { kind: 'standalone' };

/**
 * 复用策略：判定一个新打开的标签应该「并入既有同址标签」还是「独立保留」。
 * 判定规则见文件头；无比较键（内部页等）的标签一律独立保留。
 */
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
    const key = webComparisonKey(newTab.url, newTab.pendingUrl);
    if (!key) return { kind: 'standalone' };

    const candidates = windowTabs.filter((candidate) => {
      if (candidate.id === newTab.id) return false;
      return webComparisonKey(candidate.url, candidate.pendingUrl) === key;
    });
    if (candidates.length === 0) return { kind: 'standalone' };

    const established = candidates.filter((candidate) => !newlyOpenedTabIds.has(candidate.id));
    const pool = established.length > 0 ? established : candidates;

    const target = rankForKeep(pool);
    if (!target || target.id === newTab.id) return { kind: 'standalone' };
    return { kind: 'reuse', targetId: target.id };
  }
}
