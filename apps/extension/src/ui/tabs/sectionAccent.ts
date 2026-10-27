import type { TemporarySection } from '@/core/site/Sections';
import { useDataStore } from '@/stores/dataStore';
import { DragType } from '@/ui/dnd/types';
import { groupAccentVar, useDomainAccent } from '@/ui/tabs/accent';

/** 拖拽数据：原生组与虚拟分区（站点组 / 语言组）都参与排序；置顶/未分组禁用 sortable。 */
export function sectionDragDataFor(section: TemporarySection) {
  return {
    type: DragType.Section,
    sectionKey: section.key,
    groupId: section.kind === 'native' ? section.groupId : undefined,
    title: section.title,
    tabIds: section.tabs.map((tab) => tab.id)
  } as const;
}

export const isSortableDisabled = (section: TemporarySection): boolean =>
  section.kind === 'pinned' || section.kind === 'ungrouped';

/** 分组强调色推导：原生组用 Chrome 组色、站点组用域名哈希色 / favicon 主色（mono 模式统一中性）。 */
export function useSectionAccent(section: TemporarySection): string | undefined {
  const mono = useDataStore((state) => state.settings.groupAccentStyle === 'mono');
  const firstFavicon =
    section.kind === 'site' ? section.tabs.find((tab) => tab.favIconUrl)?.favIconUrl : undefined;
  const siteDomain = section.kind === 'site' ? section.siteKey : undefined;
  const siteAccent = useDomainAccent(firstFavicon, siteDomain);
  if (section.kind === 'native') return groupAccentVar(section.color);
  if (section.kind === 'site') return mono ? undefined : siteAccent;
  return undefined;
}
