import { memo, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TabRecord } from '@/core/tab-types';
import type { SiteSubGroup, TemporarySection } from '@/core/site/Sections';
import { DialogShell } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { TAB_DRAG_FINISHED_EVENT, TabRow } from '@/ui/tabs/TabRow';
import { PinnedTile } from '@/ui/tabs/PinnedTile';
import { groupAccentVar, useDomainAccent } from '@/ui/tabs/accent';

/** 原生组拖拽重排时记录被拖动组的 id（同页面内共享）。 */
let draggingGroupId: number | null = null;
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

export interface SectionCallbacks {
  onActivate: (tabId: number) => void;
  onToggleSelect: (tabId: number) => void;
  onRangeSelect: (tabId: number) => void;
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
  /** 新建命名原生组（可附带初始成员）。 */
  onGroupCreate?: (tabIds?: readonly number[]) => void;
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
  /** 用户悬停标签时按需请求当前可见页预览。 */
  onRequestPreview?: (tab: TabRecord) => void;
}

function RowList({
  tabs,
  duplicateCounts,
  activeTabId,
  splitPartners,
  selectionMode,
  selectedIds,
  reorderEnabled,
  showUrl,
  autoScrollActive,
  closeOnMiddleClick,
  density,
  showSplitBadges,
  depths,
  previews,
  highlightedIds,
  searchActiveTabId,
  callbacks
}: {
  tabs: readonly TabRecord[];
  duplicateCounts: ReadonlyMap<string, number>;
  activeTabId: number | undefined;
  splitPartners: ReadonlySet<number>;
  selectionMode: boolean;
  selectedIds: readonly number[];
  reorderEnabled: boolean;
  showUrl?: boolean;
  autoScrollActive?: boolean;
  closeOnMiddleClick?: boolean;
  density?: 'compact' | 'cozy';
  rowActionsVisible?: boolean;
  showSplitBadges?: boolean;
  /** 来源树模式下按标签 id 提供的缩进层级。 */
  depths?: ReadonlyMap<number, number>;
  /** 标签预览缩略图缓存（tabId → dataURL）。 */
  previews?: ReadonlyMap<number, string>;
  /** 当前浏览器高亮选区的标签 id 集合。 */
  highlightedIds?: ReadonlySet<number>;
  /** 当前键盘选中的搜索结果标签 id。 */
  searchActiveTabId?: number;
  callbacks: SectionCallbacks;
}) {
  return (
    <ul role="list">
      {tabs.map((tab) => (
        <TabRow
          key={tab.id}
          tab={tab}
          duplicateCount={duplicateCounts.get(tab.url || '') ?? 1}
          isActive={tab.id === activeTabId}
          isSplitCompanion={splitPartners.has(tab.id)}
          selectionMode={selectionMode}
          selected={selectedIds.includes(tab.id)}
          reorderEnabled={reorderEnabled}
          showUrl={showUrl}
          autoScrollActive={autoScrollActive}
          closeOnMiddleClick={closeOnMiddleClick}
          density={density}
          showSplitBadges={showSplitBadges}
          indent={depths?.get(tab.id)}
          preview={previews?.get(tab.id)}
          isHighlighted={highlightedIds?.has(tab.id)}
          isSearchActive={tab.id === searchActiveTabId}
          onRequestPreview={callbacks.onRequestPreview}
          onReorder={callbacks.onReorder}
          onActivate={callbacks.onActivate}
          onToggleSelect={callbacks.onToggleSelect}
          onRangeSelect={callbacks.onRangeSelect}
          onToggleMute={callbacks.onToggleMute}
          onTogglePin={callbacks.onTogglePin}
          onClose={callbacks.onCloseTab}
          onDuplicate={callbacks.onDuplicate}
          onDiscard={callbacks.onDiscard}
          onMoveTab={callbacks.onMoveTab}
        />
      ))}
    </ul>
  );
}

/** 卡片头部：标题 + 计数胶囊；可点击折叠，可选关闭（解散网站组）。 */
function SectionHead({
  icon,
  accent,
  title,
  count,
  onToggle,
  onClose,
  closeTitle,
  action,
  mediaIndicator,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: {
  icon?: ReactNode;
  /** 分组强调色；存在时在标题前渲染一条竖色条。 */
  accent?: string;
  title: string;
  count: number;
  onToggle?: () => void;
  onClose?: () => void;
  closeTitle?: string;
  /** 标题行右侧的可选操作按钮（如「存为固定文件夹」）。 */
  action?: ReactNode;
  /** 分组内媒体播放提示，可在折叠时显示并快速定位。 */
  mediaIndicator?: ReactNode;
  /** 原生组拖拽重排用。 */
  draggable?: boolean;
  onDragStart?: React.DragEventHandler;
  onDragOver?: React.DragEventHandler;
  onDragLeave?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
  onDragEnd?: React.DragEventHandler;
}) {
  const content = (
    <>
      {accent && <span className="accent-bar" aria-hidden="true" />}
      {icon}
      <span className="title">{title}</span>
    </>
  );
  return (
    <div
      className="section-head"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {onToggle ? (
        <button type="button" className="toggle" onClick={onToggle}>
          {content}
        </button>
      ) : (
        <div className="toggle">{content}</div>
      )}
      <span className="count-pill">{count}</span>
      {mediaIndicator}
      {action}
      {onClose && (
        <button type="button" className="row-action close-site" title={closeTitle} onClick={onClose}>
          <Icon d={Icons.close} className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * 单个分组卡片：根据分组类型推导强调色（原生组用 Chrome 组色、站点组用
 * 域名哈希色 / favicon 主色），并以「标题前竖色条 + 卡片淡背景」呈现。
 */
function SectionCard({
  section,
  collapsedGroups,
  collapsedSites,
  duplicateCounts,
  activeTabId,
  splitPartners,
  selectionMode,
  selectedIds,
  reorderEnabled,
  showUrl,
  autoScrollActive,
  closeOnMiddleClick,
  density,
  rowActionsVisible,
  showSplitBadges,
  previews,
  highlightedIds,
  searchActiveTabId,
  groupFirstTabIndex,
  groupLastTabIndex,
  dropPos,
  setDropPos,
  callbacks
}: {
  section: TemporarySection;
  collapsedGroups: ReadonlySet<number>;
  collapsedSites: ReadonlySet<string>;
  duplicateCounts: ReadonlyMap<string, number>;
  activeTabId: number | undefined;
  splitPartners: ReadonlySet<number>;
  selectionMode: boolean;
  selectedIds: readonly number[];
  reorderEnabled: boolean;
  showUrl?: boolean;
  autoScrollActive?: boolean;
  closeOnMiddleClick?: boolean;
  density?: 'compact' | 'cozy';
  rowActionsVisible?: boolean;
  showSplitBadges?: boolean;
  /** 标签预览缩略图缓存（tabId → dataURL）。 */
  previews?: ReadonlyMap<number, string>;
  /** 当前浏览器高亮选区的标签 id 集合。 */
  highlightedIds?: ReadonlySet<number>;
  /** 当前键盘选中的搜索结果标签 id。 */
  searchActiveTabId?: number;
  /** 拖拽目标组的首个标签 tab index（Chrome tabGroups.move 按 tab 索引定位）。 */
  groupFirstTabIndex?: number;
  /** 拖拽目标组的末尾标签 tab index。 */
  groupLastTabIndex?: number;
  /** 当前卡片是否为唯一拖拽落点目标（SectionList 层全局唯一）。 */
  dropPos?: 'before' | 'after' | null;
  setDropPos: (next: { groupId: number; place: 'before' | 'after' } | null) => void;
  callbacks: SectionCallbacks;
}) {
  const isCollapsed =
    section.kind === 'native'
      ? collapsedGroups.has(section.groupId)
      : section.kind === 'site'
        ? collapsedSites.has(section.siteKey)
        : false;

  const count = section.tabs.length;

  const { t } = useTranslation();

  // 原生组编辑对话框状态（改名 / 换色 / 删除），统一走 DialogShell 保证焦点与键盘行为。
  const [editOpen, setEditOpen] = useState(false);
  // 从折叠分组的播放提示进入后，临时只展示播放中的标签。
  const [playingOnly, setPlayingOnly] = useState(false);
  useEffect(() => {
    if (isCollapsed) setPlayingOnly(false);
  }, [isCollapsed]);

  // 原生组头部操作：存为固定文件夹 + 编辑 + 拖拽手柄。
  const headerAction =
    section.kind === 'native' ? (
      <>
        {callbacks.onSaveGroupAsFolder && (
          <button
            type="button"
            className="row-action"
            title={t('fixed.saveGroupAsFolder')}
            onClick={(event) => {
              event.stopPropagation();
              callbacks.onSaveGroupAsFolder?.(section.groupId);
            }}
          >
            <Icon d={Icons.folderDown} className="h-3.5 w-3.5" />
          </button>
        )}
        {/* 拖拽手柄：仅视觉提示，拖拽事件统一由 header 处理 */}
        <button
          type="button"
          className="row-action cursor-grab"
          title={t('groups.drag')}
        >
          <Icon d={Icons.grip} className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="row-action"
          title={t('groups.edit')}
          onClick={(event) => {
            event.stopPropagation();
            setEditOpen(true);
          }}
        >
          <Icon d={Icons.pencil} className="h-3.5 w-3.5" />
        </button>
      </>
    ) : undefined;

  const firstFavicon =
    section.kind === 'site'
      ? section.tabs.find((tab) => tab.favIconUrl)?.favIconUrl
      : undefined;
  const siteDomain = section.kind === 'site' ? section.siteKey : undefined;
  const siteAccent = useDomainAccent(firstFavicon, siteDomain);
  const accent =
    section.kind === 'native'
      ? groupAccentVar(section.color)
      : section.kind === 'site'
        ? siteAccent
        : undefined;

  const cardClass =
    'section-card' +
    (accent ? ' is-accented' : '') +
    (section.kind === 'pinned' ? ' is-pinned' : '') +
    (dropPos === 'before' ? ' is-drop-before' : dropPos === 'after' ? ' is-drop-after' : '');
  const cardStyle: CSSProperties | undefined = accent
    ? ({ '--accent': accent } as CSSProperties)
    : undefined;

  // 固定区：浏览器置顶标签 → 紧凑图标磁贴（与顶部 PinnedStrip 视觉一致，不再一行行铺开）
  if (section.kind === 'pinned') {
    return (
      <section className={cardClass} style={cardStyle}>
        <SectionHead
          icon={<Icon d={Icons.pin} className="icon h-3.5 w-3.5 text-accent-500" />}
          title={section.title}
          count={count}
          accent={accent}
        />
        <div className="section-body">
          <div className="pinned-grid">
            {section.tabs.map((tab) => (
              <PinnedTile
                key={tab.id}
                tab={tab}
                onActivate={callbacks.onActivate}
                onTogglePin={callbacks.onTogglePin}
                onClose={callbacks.onCloseTab}
                onDuplicate={callbacks.onDuplicate}
              />
            ))}
          </div>
        </div>
      </section>
    );
  }

  // 未分组：普通标签整行列表
  if (section.kind === 'ungrouped') {
    return (
      <section className={cardClass} style={cardStyle}>
        <SectionHead title={section.title} count={count} accent={accent} />
        <div className="section-body">
          <RowList
            tabs={section.tabs}
            duplicateCounts={duplicateCounts}
            activeTabId={activeTabId}
            splitPartners={splitPartners}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            reorderEnabled={reorderEnabled}
            showUrl={showUrl}
            autoScrollActive={autoScrollActive}
            closeOnMiddleClick={closeOnMiddleClick}
            density={density}
            rowActionsVisible={rowActionsVisible}
            showSplitBadges={showSplitBadges}
            depths={section.depths}
            previews={previews}
            highlightedIds={highlightedIds}
            searchActiveTabId={searchActiveTabId}
            callbacks={callbacks}
          />
        </div>
      </section>
    );
  }

  const chevron = (
    <Icon
      d={Icons.chevron}
      className={'icon h-3.5 w-3.5 transition-transform' + (isCollapsed ? '' : ' rotate-90')}
    />
  );

  const playingTab = section.tabs.find((tab) => tab.audible && !tab.muted);
  const visibleTabs = playingOnly && playingTab ? [playingTab] : section.tabs;
  // 播放提示只在折叠时显示；展开后通过单独的标签行状态识别，避免标题区重复提示。
  const mediaIndicator = isCollapsed && playingTab ? (
    <button
      type="button"
      className="section-media-indicator"
      title={t('status.jumpToPlaying')}
      aria-label={t('status.jumpToPlaying')}
      onClick={(event) => {
        event.stopPropagation();
        setPlayingOnly(true);
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
  ) : undefined;

  const header = (
    <SectionHead
      icon={chevron}
      title={section.title}
      count={count}
      accent={accent}
      onToggle={() => {
        setPlayingOnly(false);
        if (section.kind === 'native') {
          callbacks.onToggleGroupCollapsed(section.groupId, !isCollapsed);
        } else {
          callbacks.onToggleSiteCollapsed(section.siteKey, !isCollapsed);
        }
      }}
      onClose={
        section.kind === 'site'
          ? () => callbacks.onCloseSiteGroup(section.siteKey, section.tabs)
          : undefined
      }
      closeTitle={t('tabs.closeGroup')}
      mediaIndicator={mediaIndicator}
      action={headerAction}
      draggable={section.kind === 'native'}
      onDragStart={
        section.kind === 'native'
          ? (e) => {
              e.stopPropagation();
              draggingGroupId = section.groupId;
              setDropPos(null);
            }
          : undefined
      }
      onDragEnd={() => {
        draggingGroupId = null;
        setDropPos(null);
        window.dispatchEvent(new Event(TAB_DRAG_FINISHED_EVENT));
      }}
      onDragOver={
        section.kind === 'native'
          ? (e) => {
              if (draggingGroupId === null) return;
              // 跳过自身（拖自己不会作为 drop target）
              if (draggingGroupId === section.groupId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const place = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
              // 全局唯一落点：直接替换，自动清除其他组（隐式）
              setDropPos({ groupId: section.groupId, place });
            }
          : undefined
      }
      onDragLeave={
        section.kind === 'native'
          ? (e) => {
              const relatedTarget = e.relatedTarget;
              if (relatedTarget && e.currentTarget.contains(relatedTarget as Node)) return;
              setDropPos(null);
            }
          : undefined
      }
      onDrop={
        section.kind === 'native'
          ? (e) => {
              e.preventDefault();
              setDropPos(null);
              if (draggingGroupId === null || draggingGroupId === section.groupId) {
                draggingGroupId = null;
                window.dispatchEvent(new Event(TAB_DRAG_FINISHED_EVENT));
                return;
              }
              // 按真实 tab index 定位插入位置：before → 目标组首 tab 位置，after → 末尾 tab + 1
              const rect = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > rect.top + rect.height / 2;
              const targetFirst = groupFirstTabIndex ?? 0;
              const targetLast = groupLastTabIndex ?? targetFirst;
              const insertAt = after ? targetLast + 1 : targetFirst;
              callbacks.onGroupMove(draggingGroupId, insertAt);
              draggingGroupId = null;
              window.dispatchEvent(new Event(TAB_DRAG_FINISHED_EVENT));
            }
          : undefined
      }
    />
  );

  if (isCollapsed) {
    return <section className={cardClass} style={cardStyle}>{header}</section>;
  }

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

  return (
    <section className={cardClass} style={cardStyle}>
      {header}
      {section.kind === 'native' && editOpen && (
        <GroupEditDialog
          title={section.title}
          color={section.color}
          onRename={(name) => callbacks.onGroupRename(section.groupId, name)}
          onRecolor={(color) => callbacks.onGroupRecolor(section.groupId, color)}
          onDelete={() => callbacks.onGroupRemove(section.groupId)}
          onClose={() => setEditOpen(false)}
        />
      )}
      <div className="section-body">
        {subGroups.length > 0 ? (
          <div className="flex flex-col gap-1">
            {subGroups.map((sub) => (
              <div key={sub.subdomain || 'root'}>
                <div className="px-1.5 py-0 text-2xs leading-tight text-gray-500">{sub.label}</div>
                <RowList
                  tabs={sub.tabs}
                  duplicateCounts={duplicateCounts}
                  activeTabId={activeTabId}
                  splitPartners={splitPartners}
                  selectionMode={selectionMode}
                  selectedIds={selectedIds}
                  reorderEnabled={reorderEnabled}
                  showUrl={showUrl}
                  autoScrollActive={autoScrollActive}
                  closeOnMiddleClick={closeOnMiddleClick}
                  density={density}
                  rowActionsVisible={rowActionsVisible}
                  showSplitBadges={showSplitBadges}
                  previews={previews}
                  highlightedIds={highlightedIds}
                  searchActiveTabId={searchActiveTabId}
                  callbacks={callbacks}
                />
              </div>
            ))}
          </div>
        ) : (
          <RowList
            tabs={visibleTabs}
            duplicateCounts={duplicateCounts}
            activeTabId={activeTabId}
            splitPartners={splitPartners}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            reorderEnabled={reorderEnabled}
            showUrl={showUrl}
            autoScrollActive={autoScrollActive}
            closeOnMiddleClick={closeOnMiddleClick}
            density={density}
            showSplitBadges={showSplitBadges}
            depths={section.depths}
            previews={previews}
            highlightedIds={highlightedIds}
            searchActiveTabId={searchActiveTabId}
            callbacks={callbacks}
          />
        )}
      </div>
    </section>
  );
}

export const SectionList = memo(SectionListImpl);

function SectionListImpl({
  sections,
  collapsedGroups,
  collapsedSites,
  duplicateCounts,
  activeTabId,
  splitPartners,
  selectionMode,
  selectedIds,
  reorderEnabled,
  showUrl,
  autoScrollActive,
  closeOnMiddleClick,
  density,
  rowActionsVisible,
  showSplitBadges,
  previews,
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
  selectionMode: boolean;
  selectedIds: readonly number[];
  reorderEnabled: boolean;
  showUrl?: boolean;
  autoScrollActive?: boolean;
  closeOnMiddleClick?: boolean;
  density?: 'compact' | 'cozy';
  rowActionsVisible?: boolean;
  showSplitBadges?: boolean;
  /** 标签预览缩略图缓存（tabId → dataURL）。 */
  previews?: ReadonlyMap<number, string>;
  /** 当前浏览器高亮选区的标签 id 集合。 */
  highlightedIds?: ReadonlySet<number>;
  /** 当前键盘选中的搜索结果标签 id。 */
  searchActiveTabId?: number;
  callbacks: SectionCallbacks;
}) {
  const { t } = useTranslation();
  // 拖拽落点：全局唯一（最多 1 个组高亮），避免多个组件 state 残留导致绿条不消。
  const [dropPos, setDropPos] = useState<{ groupId: number; place: 'before' | 'after' } | null>(
    null
  );
  // 拖拽目标组的 firstTab/lastTab tab index（Chrome tabGroups.move({index}) 按 tab 索引）。
  const groupFirstTabIndex = new Map<number, number>();
  const groupLastTabIndex = new Map<number, number>();
  for (const s of sections) {
    if (s.kind !== 'native' || s.tabs.length === 0) continue;
    groupFirstTabIndex.set(s.groupId, s.tabs[0]!.index);
    groupLastTabIndex.set(s.groupId, s.tabs.at(-1)!.index);
  }
  useEffect(() => {
    const clearGroupDropIndicator = () => {
      draggingGroupId = null;
      setDropPos(null);
    };
    window.addEventListener(TAB_DRAG_FINISHED_EVENT, clearGroupDropIndicator);
    return () => window.removeEventListener(TAB_DRAG_FINISHED_EVENT, clearGroupDropIndicator);
  }, []);
  const collapsedSitesSet = useMemo(
    () => (collapsedSites instanceof Set ? collapsedSites : new Set(collapsedSites)),
    [collapsedSites]
  );
  return (
    <div className="flex flex-col gap-1">
      {sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
          <Icon d={Icons.search} className="h-6 w-6 text-gray-300" />
          <div className="text-sm font-medium text-gray-600">{t('empty.title')}</div>
          <div className="text-xs text-gray-400">{t('empty.hint')}</div>
        </div>
      ) : (
        sections.map((section) => {
        const isNative = section.kind === 'native';
        const nativeDropPos = isNative && dropPos?.groupId === section.groupId ? dropPos.place : null;
        return (
          <SectionCard
            key={section.key}
            section={section}
            collapsedGroups={collapsedGroups}
            collapsedSites={collapsedSitesSet}
            duplicateCounts={duplicateCounts}
            activeTabId={activeTabId}
            splitPartners={splitPartners}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            reorderEnabled={reorderEnabled}
            showUrl={showUrl}
            autoScrollActive={autoScrollActive}
            closeOnMiddleClick={closeOnMiddleClick}
            density={density}
            rowActionsVisible={rowActionsVisible}
            showSplitBadges={showSplitBadges}
            previews={previews}
            highlightedIds={highlightedIds}
            searchActiveTabId={searchActiveTabId}
            groupFirstTabIndex={isNative ? groupFirstTabIndex.get(section.groupId) : undefined}
            groupLastTabIndex={isNative ? groupLastTabIndex.get(section.groupId) : undefined}
            dropPos={nativeDropPos}
            setDropPos={setDropPos}
            callbacks={callbacks}
          />
        );
      })
      )}
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
