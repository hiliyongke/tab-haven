import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { aggregateBySite } from '@/core/site/SiteGrouping';

/**
 * 临时区视图模型：把标签镜像派生为侧边栏可渲染的 section 列表。
 *
 * 过滤规则（行为规格）：固定标签与原生标签组标签不进入临时区；
 * 固定空间的排除（文件夹挂起/绑定）在数据层接入后补充。
 */

export type TemporarySection =
  | { kind: 'site'; key: string; title: string; tabs: TabRecord[] }
  | { kind: 'ungrouped'; key: string; title: string; tabs: TabRecord[] };

export function deriveTemporarySections(
  tabs: readonly TabRecord[],
  excludedTabIds: ReadonlySet<number> = new Set()
): TemporarySection[] {
  const eligible = tabs.filter(
    (tab) => !tab.pinned && tab.groupId === NO_GROUP && !excludedTabIds.has(tab.id)
  );
  const { groups, singles } = aggregateBySite(eligible);

  const sections: TemporarySection[] = groups.map((group) => ({
    kind: 'site',
    key: `site-${group.key.value}`,
    title: group.key.label,
    tabs: group.tabs
  }));

  if (singles.length > 0) {
    sections.push({ kind: 'ungrouped', key: 'ungrouped', title: '未分组', tabs: singles });
  }

  return sections;
}
