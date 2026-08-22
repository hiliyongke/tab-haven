import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import type { TemporarySection } from '@/core/site/Sections';
import { Icon, Icons } from '@/ui/common/Icon';
import { TabRow } from '@/ui/tabs/TabRow';

/**
 * 临时区 section 列表：原生组 → 网站组 → 未分组。
 * 折叠状态由调用方（store/本地态）持有并通过 props 回传。
 */

export interface SectionCallbacks {
  onActivate: (tabId: number) => void;
  onToggleSelect: (tabId: number) => void;
  onRangeSelect: (tabId: number) => void;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onCloseTab: (tab: TabRecord) => void;
  onToggleGroupCollapsed: (groupId: number, collapsed: boolean) => void;
  onToggleSiteCollapsed: (siteKey: string, collapsed: boolean) => void;
  onCloseSiteGroup: (siteKey: string, tabs: readonly TabRecord[]) => void;
}

export function SectionList({
  sections,
  collapsedGroups,
  collapsedSites,
  duplicateCounts,
  activeTabId,
  splitPartners,
  selectionMode,
  selectedIds,
  callbacks
}: {
  sections: readonly TemporarySection[];
  collapsedGroups: ReadonlySet<number>;
  collapsedSites: ReadonlySet<string>;
  duplicateCounts: ReadonlyMap<string, number>;
  activeTabId: number | undefined;
  /** 与当前激活标签同屏的伙伴 id 集合。 */
  splitPartners: ReadonlySet<number>;
  selectionMode: boolean;
  selectedIds: readonly number[];
  callbacks: SectionCallbacks;
}) {
  return (
    <div>
      {sections.map((section) => {
        const isCollapsed =
          section.kind === 'native'
            ? collapsedGroups.has(section.groupId)
            : section.kind === 'site'
              ? collapsedSites.has(section.siteKey)
              : false;

        const header = (
          <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500">
            {section.kind === 'native' && (
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: `var(--group-${section.color || 'grey'})` }}
                aria-hidden="true"
              />
            )}
            {section.kind === 'site' && (
              <Icon d={Icons.chevron} className={'h-3 w-3 ' + (isCollapsed ? '' : 'rotate-90')} />
            )}
            <button
              type="button"
              className="flex flex-1 items-center gap-1 text-left"
              onClick={() => {
                if (section.kind === 'native') {
                  callbacks.onToggleGroupCollapsed(section.groupId, !isCollapsed);
                } else if (section.kind === 'site') {
                  callbacks.onToggleSiteCollapsed(section.siteKey, !isCollapsed);
                }
              }}
            >
              <span className="truncate">{section.title}</span>
              <span className="text-gray-400">{section.tabs.length}</span>
            </button>
            {section.kind === 'site' && (
              <button
                type="button"
                className="text-gray-300 opacity-0 hover:text-red-500 focus:opacity-100"
                title="关闭组内全部标签"
                onClick={() => callbacks.onCloseSiteGroup(section.siteKey, section.tabs)}
              >
                <Icon d={Icons.close} className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );

        if (isCollapsed) {
          return (
            <section key={section.key} className="mb-1">
              {header}
            </section>
          );
        }

        return (
          <section key={section.key} className="mb-2">
            {header}
            <div>
              {section.tabs.map((tab) => (
                <TabRow
                  key={tab.id}
                  tab={tab}
                  duplicateCount={duplicateCounts.get(tab.url || '') ?? 1}
                  isActive={tab.id === activeTabId}
                  isSplitCompanion={splitPartners.has(tab.id)}
                  selectionMode={selectionMode}
                  selected={selectedIds.includes(tab.id)}
                  onActivate={callbacks.onActivate}
                  onToggleSelect={callbacks.onToggleSelect}
                  onRangeSelect={callbacks.onRangeSelect}
                  onToggleMute={callbacks.onToggleMute}
                  onTogglePin={callbacks.onTogglePin}
                  onClose={callbacks.onCloseTab}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 供父组件计算拆分伙伴集合。 */
export function splitPartnerIds(tabs: readonly TabRecord[], activeTabId: number | undefined): Set<number> {
  const active = tabs.find((tab) => tab.id === activeTabId);
  const activeSplit = active?.splitViewId;
  if (activeSplit === undefined || active?.active) return new Set();
  return new Set(
    tabs
      .filter((tab) => tab.id !== activeTabId && tab.splitViewId === activeSplit)
      .map((tab) => tab.id)
  );
}

/** 供父组件占位导出（原生组数据）。 */
export function groupColorVar(group: TabGroupRecord): string {
  return `var(--group-${group.color || 'grey'})`;
}
