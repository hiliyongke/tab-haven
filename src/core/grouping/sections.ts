import { NO_GROUP, type TabRecord } from '@/core/tab-types';
import { collectWebsiteGroups } from '@/core/grouping/collect';

/**
 * 临时区 section 派生（纯函数）：网站分组 + 未分组。
 * 原生标签组 section 与固定空间（文件夹/pin）在下个迭代接入 tabGroups 与
 * dataStore 数据后扩展。
 */

export type TemporarySection =
  | { kind: 'site'; key: string; title: string; tabs: TabRecord[]; siteKey: string }
  | { kind: 'ungrouped'; key: string; title: string; tabs: TabRecord[] };

export function deriveTemporarySections(
  tabs: readonly TabRecord[],
  manualStandaloneTabIds: ReadonlySet<number> = new Set()
): TemporarySection[] {
  // 基线过滤：未固定且无原生组（固定文件夹的 pending/bound 排除在数据层接入后补充）。
  const ungroupedTabs = tabs.filter((tab) => !tab.pinned && tab.groupId === NO_GROUP);
  const { websiteGroups, standaloneTabs } = collectWebsiteGroups(ungroupedTabs, manualStandaloneTabIds);

  const sections: TemporarySection[] = websiteGroups.map((group) => ({
    kind: 'site',
    key: `site-${group.key}`,
    title: group.label,
    tabs: group.tabs,
    siteKey: group.key
  }));

  if (standaloneTabs.length > 0) {
    sections.push({
      kind: 'ungrouped',
      key: 'ungrouped',
      title: '未分组',
      tabs: standaloneTabs
    });
  }

  return sections;
}
