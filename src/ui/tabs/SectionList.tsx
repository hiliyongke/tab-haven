import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { TabRecord } from '@/core/tab-types';
import type { SiteSubGroup, TemporarySection } from '@/core/site/Sections';
import { DialogShell } from '@/ui/dialog/Dialog';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { GroupCard } from '@/ui/common/GroupCard';
import { Icon, Icons } from '@/ui/common/Icon';
import { TabRow } from '@/ui/tabs/TabRow';
import { DragType } from '@/ui/dnd/types';
import { groupAccentVar, useDomainAccent } from '@/ui/tabs/accent';
import { computeSplitGroupRoles } from '@/ui/tabs/splitGroupRoles';
import { useDataStore } from '@/stores/dataStore';
/** 用户主动定位当前标签时，请求临时区展开其所属分组。 */
export const LOCATE_SECTION_EVENT = 'tabhaven:locate-section';

/** 原生组可使用的标准颜色（tabGroups 枚举）。 */
const GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
] as const;

/** 原生组编辑弹窗：改名 + 换色 + 删除（复用 DialogShell 的焦点/键盘行为）。 */
function GroupEditDialog({
  title,
  color,
  onRename,
  onRecolor,
  onDelete,
  onClose
}: {
  title: string;
  color?: string;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (confirmDelete) {
    return (
      <DialogShell title={t('groups.delete')} onClose={() => setConfirmDelete(false)}>
        <p className="mb-3 text-sm text-gray-600">{t('groups.deleteConfirm', { name: title })}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
            onClick={() => setConfirmDelete(false)}
          >
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-red-600 px-3 py-1 text-sm text-on-accent hover:opacity-90"
            onClick={onDelete}
          >
            {t('dialog.confirm')}
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title={t('groups.edit')} onClose={onClose}>
      <input
        className="mb-2 w-full rounded border border-gray-300 bg-surface px-2 py-1.5 text-sm text-gray-800 outline-none focus:border-accent-500"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onRename(draft.trim() || title);
            onClose();
          }
        }}
        placeholder={t('groups.namePlaceholder')}
      />
      <div className="mb-2 flex flex-wrap gap-1">
        {GROUP_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={
              'h-4 w-4 rounded-full border border-gray-300' +
              (color === c ? ' ring-2 ring-offset-1 ring-gray-400' : '')
            }
            style={{ backgroundColor: groupAccentVar(c) }}
            title={c}
            aria-label={c}
            onClick={() => onRecolor(c)}
          />
        ))}
      </div>
      <div className="flex justify-between">
        <button
          type="button"
          className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50"
          onClick={() => setConfirmDelete(true)}
        >
          {t('groups.delete')}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-accent-600 px-3 py-1 text-sm text-on-accent hover:bg-accent-700"
            onClick={() => {
              onRename(draft.trim() || title);
              onClose();
            }}
          >
            {t('dialog.confirm')}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

/**
 * 临时区 section 列表：固定区（置顶）→ 原生组 → 网站组（含子域折叠）→ 未分组。
 * 每个 section 渲染为独立卡片（.section-card），标题/计数清晰，分组辨识度更高。
 * 折叠状态由调用方（本地态）持有并通过 props 回传。
 */

interface SectionCallbacks {
  onActivate: (tabId: number) => void;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onCloseTab: (tab: TabRecord) => void;
  /** 复制标签。 */
  onDuplicate?: (tab: TabRecord) => void;
  /** 冻结（休眠）标签。 */
  onDiscard?: (tab: TabRecord) => void;
  /** 将原生标签组存为固定文件夹（原生组→文件夹桥接）。 */
  onSaveGroupAsFolder?: (groupId: number) => void;
  onToggleGroupCollapsed: (groupId: number, collapsed: boolean) => void;
  onToggleSiteCollapsed: (siteKey: string, collapsed: boolean) => void;
  onCloseSiteGroup: (siteKey: string, tabs: readonly TabRecord[]) => void;
  /** 拖拽重排写回原生顺序（可选能力，由设置开关控制）。 */
  onReorder?: (sourceId: number, targetId: number, placeAfter: boolean) => void;
  /** 键盘重排（Alt+↑/↓）：把标签向相邻位置移动。 */
  onMoveTab?: (tabId: number, direction: -1 | 1) => void;
  /** 重命名原生组。 */
  onGroupRename: (groupId: number, title: string) => void;
  /** 改变原生组颜色。 */
  onGroupRecolor: (groupId: number, color: string) => void;
  /** 删除原生组（解散，不关闭标签）。 */
  onGroupRemove: (groupId: number) => void;
  /** 移动原生组到指定索引（组排序）。 */
  onGroupMove: (groupId: number, index: number) => void;
  /** 高亮当前选中的标签（与浏览器多选同步）。 */
  onHighlightSelected?: () => void;
}

function RowList({
  tabs,
  duplicateCounts,
  activeTabId,
  splitPartners,
  reorderEnabled,
  showUrl,
  rowActionsVisible,
  autoScrollActive,
  closeOnMiddleClick,
  density,
  showSplitBadges,
  depths,
  highlightedIds,
  searchActiveTabId,
  callbacks,
  containerKey
}: {
  tabs: readonly TabRecord[];
  duplicateCounts: ReadonlyMap<string, number>;
  activeTabId: number | undefined;
  splitPartners: ReadonlySet<number>;
  reorderEnabled: boolean;
  showUrl?: boolean;
  autoScrollActive?: boolean;
  closeOnMiddleClick?: boolean;
  density?: 'compact' | 'cozy';
  rowActionsVisible?: boolean;
  showSplitBadges?: boolean;
  /** 来源树模式下按标签 id 提供的缩进层级。 */
  depths?: ReadonlyMap<number, number>;
  /** 当前浏览器高亮选区的标签 id 集合。 */
  highlightedIds?: ReadonlySet<number>;
  /** 当前键盘选中的搜索结果标签 id。 */
  searchActiveTabId?: number;
  callbacks: SectionCallbacks;
  /** 所属容器 key（section key），供全局拖拽判断同容器排序。 */
  containerKey: string;
}) {
  // 分屏组竖线角色：同一 splitViewId 的「连续」标签段 → 组首/组中/组尾（单标签段也画线）。
  const splitGroupRoles = useMemo(() => computeSplitGroupRoles(tabs), [tabs]);

  return (
    <SortableContext items={tabs.map((tab) => tab.id)} strategy={verticalListSortingStrategy}>
      <ul>
        {tabs.map((tab) => (
          <TabRow
            key={tab.id}
            tab={tab}
            duplicateCount={duplicateCounts.get(tab.url || '') ?? 1}
            isActive={tab.id === activeTabId}
            isSplitCompanion={splitPartners.has(tab.id)}
            splitGroupRole={splitGroupRoles.get(tab.id)}
            reorderEnabled={reorderEnabled}
            showUrl={showUrl}
            rowActionsVisible={rowActionsVisible}
            autoScrollActive={autoScrollActive}
            closeOnMiddleClick={closeOnMiddleClick}
            density={density}
            showSplitBadges={showSplitBadges}
            indent={depths?.get(tab.id)}
            isHighlighted={highlightedIds?.has(tab.id)}
            isSearchActive={tab.id === searchActiveTabId}
            onActivate={callbacks.onActivate}
            onToggleMute={callbacks.onToggleMute}
            onTogglePin={callbacks.onTogglePin}
            onClose={callbacks.onCloseTab}
            onDuplicate={callbacks.onDuplicate}
            onDiscard={callbacks.onDiscard}
            onMoveTab={callbacks.onMoveTab}
            containerKey={containerKey}
          />
        ))}
      </ul>
    </SortableContext>
  );
}

/** SectionCard 全部输入（跨子组件共享）。 */
interface SectionCardProps {
  section: TemporarySection;
  collapsedGroups: ReadonlySet<number>;
  collapsedSites: ReadonlySet<string>;
  duplicateCounts: ReadonlyMap<string, number>;
  activeTabId: number | undefined;
  splitPartners: ReadonlySet<number>;
  reorderEnabled: boolean;
  showUrl?: boolean;
  autoScrollActive?: boolean;
  closeOnMiddleClick?: boolean;
  density?: 'compact' | 'cozy';
  rowActionsVisible?: boolean;
  showSplitBadges?: boolean;
  /** 当前浏览器高亮选区的标签 id 集合。 */
  highlightedIds?: ReadonlySet<number>;
  /** 当前键盘选中的搜索结果标签 id。 */
  searchActiveTabId?: number;
  callbacks: SectionCallbacks;
}

/** RowList 的透传输入（SectionCardProps 中与行渲染相关的字段）。 */
type RowListPassthrough = Pick<
  SectionCardProps,
  | 'duplicateCounts'
  | 'activeTabId'
  | 'splitPartners'
  | 'reorderEnabled'
  | 'showUrl'
  | 'rowActionsVisible'
  | 'autoScrollActive'
  | 'closeOnMiddleClick'
  | 'density'
  | 'showSplitBadges'
  | 'highlightedIds'
  | 'searchActiveTabId'
  | 'callbacks'
>;

/** 统一的行列表渲染（RowList 的输入 props 在此一次性透传）。 */
function SectionRows({
  tabs,
  depths,
  containerKey,
  ...rest
}: { tabs: readonly TabRecord[]; depths?: ReadonlyMap<number, number>; containerKey: string } & RowListPassthrough) {
  return <RowList tabs={tabs} depths={depths} containerKey={containerKey} {...rest} />;
}

/** 拖拽数据：原生组参与排序；站点组仅支持拖出到固定空间；置顶/未分组禁用 sortable。 */
function sectionDragDataFor(section: TemporarySection) {
  return {
    type: DragType.Section,
    sectionKey: section.key,
    groupId: section.kind === 'native' ? section.groupId : undefined,
    title: section.title,
    tabIds: section.tabs.map((tab) => tab.id)
  } as const;
}

const isSortableDisabled = (section: TemporarySection): boolean =>
  section.kind === 'pinned' || section.kind === 'ungrouped';

/** 分组强调色推导：原生组用 Chrome 组色、站点组用域名哈希色 / favicon 主色（mono 模式统一中性）。 */
function useSectionAccent(section: TemporarySection): string | undefined {
  const mono = useDataStore((state) => state.settings.groupAccentStyle === 'mono');
  const firstFavicon =
    section.kind === 'site'
      ? section.tabs.find((tab) => tab.favIconUrl)?.favIconUrl
      : undefined;
  const siteDomain = section.kind === 'site' ? section.siteKey : undefined;
  const siteAccent = useDomainAccent(firstFavicon, siteDomain);
  if (section.kind === 'native') return groupAccentVar(section.color);
  if (section.kind === 'site') return mono ? undefined : siteAccent;
  return undefined;
}

/** 折叠时显示的播放提示（点击展开分组并定位到播放标签）。 */
function PlayingIndicator({
  playingTab,
  isCollapsed,
  section,
  callbacks,
  onPlay
}: {
  playingTab: TabRecord;
  isCollapsed: boolean;
  section: Extract<TemporarySection, { kind: 'native' | 'site' }>;
  callbacks: SectionCallbacks;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="section-media-indicator"
      title={t('status.jumpToPlaying')}
      aria-label={t('status.jumpToPlaying')}
      onClick={(event) => {
        event.stopPropagation();
        onPlay();
        if (isCollapsed) {
          if (section.kind === 'native') {
            callbacks.onToggleGroupCollapsed(section.groupId, false);
          } else {
            callbacks.onToggleSiteCollapsed(section.siteKey, false);
          }
        }
        callbacks.onActivate(playingTab.id);
      }}
    >
      <Icon d={Icons.mute} className="h-3 w-3" />
      <span className="section-media-label">{t('status.playing')}</span>
      <span className="section-media-dot" aria-hidden="true" />
    </button>
  );
}

/** 未分组：普通标签整行列表。 */
function UngroupedSectionCard({
  section,
  ...rowProps
}: Omit<SectionCardProps, 'section'> & { section: Extract<TemporarySection, { kind: 'ungrouped' }> }) {
  const accent = useSectionAccent(section);
  return (
    <GroupCard
      id={section.key}
      dragData={sectionDragDataFor(section)}
      disabled={isSortableDisabled(section)}
      title={section.title}
      count={section.tabs.length}
      accent={accent}
    >
      <div className="section-body">
        <SectionRows tabs={section.tabs} depths={section.depths} containerKey={section.key} {...rowProps} />
      </div>
    </GroupCard>
  );
}

/** 可折叠分组卡（原生组 / 站点组）：折叠、播放提示、子域分块、原生组编辑弹窗。 */
function CollapsibleSectionCard({
  section,
  collapsedGroups,
  collapsedSites,
  ...rowProps
}: Omit<SectionCardProps, 'section'> & {
  section: Extract<TemporarySection, { kind: 'native' | 'site' }>;
}) {
  const { t } = useTranslation();
  const isCollapsed =
    section.kind === 'native'
      ? collapsedGroups.has(section.groupId)
      : collapsedSites.has(section.siteKey);
  const count = section.tabs.length;

  // 原生组编辑对话框状态（改名 / 换色 / 删除），统一走 DialogShell 保证焦点与键盘行为。
  const [editOpen, setEditOpen] = useState(false);
  // 从折叠分组的播放提示进入后，临时只展示播放中的标签。
  const [playingOnly, setPlayingOnly] = useState(false);
  useEffect(() => {
    if (isCollapsed) setPlayingOnly(false);
  }, [isCollapsed]);

  const accent = useSectionAccent(section);
  const chevron = (
    <Icon
      d={Icons.chevron}
      className={'icon h-3.5 w-3.5 transition-transform' + (isCollapsed ? '' : ' rotate-90')}
    />
  );

  const playingTab = section.tabs.find((tab) => tab.audible && !tab.muted);
  const visibleTabs = playingOnly && playingTab ? [playingTab] : section.tabs;
  // 播放提示只在折叠时显示；展开后通过单独的标签行状态识别，避免标题区重复提示。
  const mediaIndicator =
    isCollapsed && playingTab ? (
      <PlayingIndicator
        playingTab={playingTab}
        isCollapsed={isCollapsed}
        section={section}
        callbacks={rowProps.callbacks}
        onPlay={() => setPlayingOnly(true)}
      />
    ) : undefined;

  // 原生组头部操作：存为固定文件夹 + 编辑（拖拽事件由 dnd-kit 在 head 接管，无需独立手柄按钮）。
  const headerAction = section.kind === 'native' ? (
    <>
      {rowProps.callbacks.onSaveGroupAsFolder && (
        <button
          type="button"
          className="row-action"
          title={t('fixed.saveGroupAsFolder')}
          aria-label={t('fixed.saveGroupAsFolder')}
          onClick={(event) => {
            event.stopPropagation();
            rowProps.callbacks.onSaveGroupAsFolder?.(section.groupId);
          }}
        >
          <Icon d={Icons.saveToFolder} className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        className="row-action"
        title={t('groups.edit')}
        aria-label={t('groups.edit')}
        onClick={(event) => {
          event.stopPropagation();
          setEditOpen(true);
        }}
      >
        <Icon d={Icons.pencil} className="h-3.5 w-3.5" />
      </button>
    </>
  ) : undefined;

  const onToggle = () => {
    setPlayingOnly(false);
    if (section.kind === 'native') {
      rowProps.callbacks.onToggleGroupCollapsed(section.groupId, !isCollapsed);
    } else {
      rowProps.callbacks.onToggleSiteCollapsed(section.siteKey, !isCollapsed);
    }
  };
  const onClose =
    section.kind === 'site'
      ? () => rowProps.callbacks.onCloseSiteGroup(section.siteKey, section.tabs)
      : undefined;

  // 展开态：site 多子域时按子域再分块（折叠子标题）；媒体定位模式只保留播放标签所在子域。
  const subGroups: SiteSubGroup[] =
    section.kind === 'site'
      ? section.subgroups
          .map((sub) => ({
            ...sub,
            tabs: playingOnly ? sub.tabs.filter((tab) => tab.id === playingTab?.id) : sub.tabs
          }))
          .filter((sub) => sub.tabs.length > 0)
      : [];

  const renderBody = () => (
    <>
      {section.kind === 'native' && editOpen && (
        <GroupEditDialog
          title={section.title}
          color={section.color}
          onRename={(name) => rowProps.callbacks.onGroupRename(section.groupId, name)}
          onRecolor={(color) => rowProps.callbacks.onGroupRecolor(section.groupId, color)}
          onDelete={() => rowProps.callbacks.onGroupRemove(section.groupId)}
          onClose={() => setEditOpen(false)}
        />
      )}
      <div className="section-body">
        {subGroups.length > 0 ? (
          <div className="flex flex-col gap-1">
            {subGroups.map((sub) => (
              <div key={sub.subdomain || 'root'}>
                <div className="px-1.5 py-0 text-2xs leading-tight text-gray-500">{sub.label}</div>
                <SectionRows tabs={sub.tabs} containerKey={section.key} {...rowProps} />
              </div>
            ))}
          </div>
        ) : (
          <SectionRows
            tabs={visibleTabs}
            depths={section.depths}
            containerKey={section.key}
            {...rowProps}
          />
        )}
      </div>
    </>
  );

  return (
    <GroupCard
      id={section.key}
      dragData={sectionDragDataFor(section)}
      disabled={isSortableDisabled(section)}
      title={section.title}
      count={count}
      accent={accent}
      icon={chevron}
      onToggle={onToggle}
      onClose={onClose}
      closeTitle={t('tabs.closeGroup')}
      mediaIndicator={mediaIndicator}
      action={headerAction}
      collapsed={isCollapsed}
    >
      {isCollapsed ? null : renderBody()}
    </GroupCard>
  );
}

/**
 * 单个分组卡片：按类型分发到未分组 / 可折叠（原生组 + 站点组）子组件。
 * 强调色推导（原生组 Chrome 组色、站点组域名哈希色 / favicon 主色）由 useSectionAccent 统一处理。
 * 注意：浏览器置顶（pinned）由 App 层 CategoryModule 单独渲染，不会进入本列表。
 */
function SectionCard(props: SectionCardProps) {
  const { section } = props;
  if (section.kind === 'pinned') return null;
  if (section.kind === 'ungrouped') return <UngroupedSectionCard {...props} section={section} />;
  // 走到这里 section 已收窄为 native | site
  return <CollapsibleSectionCard {...props} section={section} />;
}

export const SectionList = memo(SectionListImpl);

function SectionListImpl({
  sections,
  collapsedGroups,
  collapsedSites,
  duplicateCounts,
  activeTabId,
  splitPartners,
  reorderEnabled,
  showUrl,
  autoScrollActive,
  closeOnMiddleClick,
  density,
  rowActionsVisible,
  showSplitBadges,
  highlightedIds,
  searchActiveTabId,
  callbacks
}: {
  sections: readonly TemporarySection[];
  collapsedGroups: ReadonlySet<number>;
  collapsedSites: ReadonlySet<string> | readonly string[];
  duplicateCounts: ReadonlyMap<string, number>;
  activeTabId: number | undefined;
  /** 与当前激活标签同屏的伙伴 id 集合。 */
  splitPartners: ReadonlySet<number>;
  reorderEnabled: boolean;
  showUrl?: boolean;
  autoScrollActive?: boolean;
  closeOnMiddleClick?: boolean;
  density?: 'compact' | 'cozy';
  rowActionsVisible?: boolean;
  showSplitBadges?: boolean;
  /** 当前浏览器高亮选区的标签 id 集合。 */
  highlightedIds?: ReadonlySet<number>;
  /** 当前键盘选中的搜索结果标签 id。 */
  searchActiveTabId?: number;
  callbacks: SectionCallbacks;
}) {
  const { t } = useTranslation();
  const collapsedSitesSet = useMemo(
    () => (collapsedSites instanceof Set ? collapsedSites : new Set(collapsedSites)),
    [collapsedSites]
  );

  useEffect(() => {
    const handleLocateSection = (event: Event) => {
      const tabId = (event as CustomEvent<number>).detail;
      if (!Number.isInteger(tabId)) return;
      const section = sections.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId));
      if (!section) return;
      if (section.kind === 'native' && collapsedGroups.has(section.groupId)) {
        callbacks.onToggleGroupCollapsed(section.groupId, false);
      } else if (section.kind === 'site' && collapsedSitesSet.has(section.siteKey)) {
        callbacks.onToggleSiteCollapsed(section.siteKey, false);
      }
    };
    window.addEventListener(LOCATE_SECTION_EVENT, handleLocateSection);
    return () => window.removeEventListener(LOCATE_SECTION_EVENT, handleLocateSection);
  }, [callbacks, collapsedGroups, collapsedSitesSet, sections]);

  // 分组头排序（dnd-kit）：只对原生组参与排序，排序逻辑由全局 DndContext 的 onDragEnd 处理。
  const sortableSectionKeys = sections
    .filter((s) => s.kind === 'native')
    .map((s) => s.key);

  const nativeSiteSections = sections.filter(
    (s) => s.kind === 'native' || s.kind === 'site'
  );
  const ungroupedSection = sections.find((s) => s.kind === 'ungrouped');

  const renderSectionCard = (section: TemporarySection) => (
    <SectionCard
      key={section.key}
      section={section}
      collapsedGroups={collapsedGroups}
      collapsedSites={collapsedSitesSet}
      duplicateCounts={duplicateCounts}
      activeTabId={activeTabId}
      splitPartners={splitPartners}
      reorderEnabled={reorderEnabled}
      showUrl={showUrl}
      rowActionsVisible={rowActionsVisible}
      autoScrollActive={autoScrollActive}
      closeOnMiddleClick={closeOnMiddleClick}
      density={density}
      showSplitBadges={showSplitBadges}
      highlightedIds={highlightedIds}
      searchActiveTabId={searchActiveTabId}
      callbacks={callbacks}
    />
  );

  return (
    <SortableContext items={sortableSectionKeys} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col gap-1">
        {sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
            <Icon d={Icons.search} className="h-6 w-6 text-gray-300" />
            <div className="text-sm font-medium text-gray-600">{t('empty.title')}</div>
            <div className="text-xs text-gray-400">{t('empty.hint')}</div>
          </div>
        ) : (
          <>
            {nativeSiteSections.length > 0 && (
              <CategoryModule
                title={t('groups.label')}
                count={nativeSiteSections.length}
                className="module-shell groups-module"
              >
                {nativeSiteSections.map(renderSectionCard)}
              </CategoryModule>
            )}
            {ungroupedSection && renderSectionCard(ungroupedSection)}
          </>
        )}
      </div>
    </SortableContext>
  );
}

/** 供父组件计算拆分伙伴集合：与当前激活标签同 splitViewId 的其它标签。 */
export function splitPartnerIds(tabs: readonly TabRecord[], activeTabId: number | undefined): Set<number> {
  const active = tabs.find((tab) => tab.id === activeTabId);
  const activeSplit = active?.splitViewId;
  if (activeSplit === undefined) return new Set();
  return new Set(
    tabs
      .filter((tab) => tab.id !== activeTabId && tab.splitViewId === activeSplit)
      .map((tab) => tab.id)
  );
}
