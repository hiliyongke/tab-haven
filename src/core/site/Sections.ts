import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { aggregateBySite, type SiteSubGroup } from '@/core/site/SiteGrouping';

export type { SiteSubGroup } from '@/core/site/SiteGrouping';

/**
 * 临时区视图模型：把标签镜像派生为侧边栏可渲染的 section 列表。
 *
 * section 顺序（行为规格）：
 *   固定标签区（置顶）→ 原生标签组 → 网站聚合组 → 未分组。
 * 固定空间的排除（文件夹挂起/绑定）由 excludedTabIds 传入（数据层接入后填充）。
 */

export type TemporarySection =
  | { kind: 'pinned'; key: string; title: string; tabs: TabRecord[] }
  | {
      kind: 'native';
      key: string;
      title: string;
      tabs: TabRecord[];
      groupId: number;
      color?: string;
      collapsed: boolean;
    }
  | {
      kind: 'site';
      key: string;
      title: string;
      tabs: TabRecord[];
      siteKey: string;
      /** 多子域时的折叠子分组；单子域时为长度 0。 */
      subgroups: SiteSubGroup[];
    }
  | { kind: 'ungrouped'; key: string; title: string; tabs: TabRecord[] };

export interface SectionDerivation {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  /** 从临时区排除的标签（固定空间挂起/绑定、手动移出等）。 */
  excludedTabIds?: ReadonlySet<number>;
}

export function deriveSections({
  tabs,
  groups,
  excludedTabIds
}: SectionDerivation): TemporarySection[] {
  const excluded = excludedTabIds ?? new Set<number>();
  const sections: TemporarySection[] = [];

  // 固定标签区（置顶，独立成区，不混入原生组/站点组/未分组）。
  const pinnedTabs = tabs
    .filter((tab) => tab.pinned && !excluded.has(tab.id))
    .sort((a, b) => a.index - b.index);
  if (pinnedTabs.length > 0) {
    sections.push({ kind: 'pinned', key: 'pinned', title: '固定标签', tabs: pinnedTabs });
  }

  // 原生标签组：组内标签按位置序，排除绑定到固定空间的标签与固定标签。
  const groupsByFirstTab = groups
    .map((group) => ({
      group,
      groupTabs: tabs.filter(
        (tab) => !tab.pinned && tab.groupId === group.id && !excluded.has(tab.id)
      )
    }))
    .filter(({ groupTabs }) => groupTabs.length > 0)
    .sort((a, b) => (a.groupTabs[0]?.index ?? 0) - (b.groupTabs[0]?.index ?? 0));

  for (const { group, groupTabs } of groupsByFirstTab) {
    sections.push({
      kind: 'native',
      key: `group-${group.id}`,
      title: group.title || '未命名标签组',
      tabs: groupTabs,
      groupId: group.id,
      color: group.color,
      collapsed: group.collapsed ?? false
    });
  }

  // 站点聚合 + 未分组（固定标签已单独分区，此处不再纳入）。
  const eligible = tabs.filter(
    (tab) => !tab.pinned && tab.groupId === NO_GROUP && !excluded.has(tab.id)
  );
  const { groups: siteGroups, singles } = aggregateBySite(eligible);

  for (const group of siteGroups) {
    // 多子域时标题用注册域（子域以 subgroups 折叠展示）；
    // 单子域时标题直接用子域标签，subgroups 为空保持扁平。
    const title =
      group.subgroups.length > 0 ? group.key.value : group.key.label;
    sections.push({
      kind: 'site',
      key: `site-${group.key.value}`,
      title,
      tabs: group.tabs,
      siteKey: group.key.value,
      subgroups: group.subgroups
    });
  }

  if (singles.length > 0) {
    sections.push({ kind: 'ungrouped', key: 'ungrouped', title: '未分组', tabs: singles });
  }

  return sections;
}
