import { memo, useState } from 'react';
import { useTranslation } from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import type { TemporarySection } from '@/core/site/Sections';
import { GroupCard } from '@/ui/common/GroupCard';
import { CollapseChevron } from '@/ui/common/CollapseChevron';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowActionButton } from '@/ui/common/RowActionButton';
import { GroupEditDialog } from '@/ui/tabs/GroupEditDialog';
import { SectionRows } from '@/ui/tabs/rowList';
import { isSortableDisabled, sectionDragDataFor, useSectionAccent } from '@/ui/tabs/sectionAccent';
import type { SectionCallbacks, SectionCardProps } from '@/ui/tabs/sectionTypes';

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
    // 刻意保留裸 button：onClick 需要事件对象做 stopPropagation（隔离分组头部的
    // 点击冒泡），而 Button / IconButton 的 onClick 都是 () => void；RowActionButton
    // 虽然带事件，但它内部固定 .row-action（width/height: 20px），会把这个带文字
    // 的胶囊压成 20×20。
    <button
      type="button"
      className="section-media-indicator"
      title={t('定位到播放中的标签')}
      aria-label={t('定位到播放中的标签')}
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
      <Icon d={Icons.volumeOn} className="h-3 w-3" />
      <span className="section-media-label">{t('播放中')}</span>
      <span className="section-media-dot" aria-hidden="true" />
    </button>
  );
}

/**
 * 可折叠分组卡（原生组 / 站点组）：折叠、播放提示、原生组编辑弹窗。
 *
 * 从 `sectionCards` 拆出的原因：它是分区卡里唯一带**本地状态**（编辑弹窗开合、
 * 播放中筛选）的一种，与「未分组卡」和「行列表」的复用关系为零，同处一个文件
 * 时改折叠态要在三段 JSX 之间跳读。
 */
export const CollapsibleSectionCard = memo(function CollapsibleSectionCard({
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
  /**
   * 从折叠分组的播放提示进入后，临时只展示播放中的标签。
   *
   * 「是否生效」是渲染期直接算出来的（下面 `visibleTabs` 里的 `!isCollapsed`），
   * 不再用 effect 把 `isCollapsed` 的变化回写进 state —— 那是一次「渲染 → 副作用
   * → 再渲染」的额外往返，且让 `playingOnly` 与 `isCollapsed` 成了两份需要人肉
   * 保持同步的状态。
   */
  const [playingOnly, setPlayingOnly] = useState(false);

  const accent = useSectionAccent(section);
  const chevron = <CollapseChevron collapsed={isCollapsed} />;

  const playingTab = section.tabs.find((tab) => tab.audible && !tab.muted);
  // 折叠态不渲染 body，故「播放中筛选」只在展开时成立；展开即生效，无需回写 state。
  const visibleTabs = playingOnly && !isCollapsed && playingTab ? [playingTab] : section.tabs;
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
  const headerAction =
    section.kind === 'native' ? (
      <>
        {rowProps.callbacks.onSaveGroupAsFolder && (
          <RowActionButton
            icon={Icons.folderPlus}
            label={t('存为文件夹')}
            onClick={(event) => {
              event.stopPropagation();
              rowProps.callbacks.onSaveGroupAsFolder?.(section.groupId);
            }}
          />
        )}
        <RowActionButton
          icon={Icons.pencil}
          label={t('编辑标签组')}
          onClick={(event) => {
            event.stopPropagation();
            setEditOpen(true);
          }}
        />
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
  // 展开态：站点分区永远平铺渲染（子域折叠模式已移除，层级只有一级）。
  const renderBody = () => (
    <div className="section-body">
      <SectionRows
        tabs={visibleTabs}
        depths={section.depths}
        containerKey={section.key}
        {...rowProps}
      />
    </div>
  );

  return (
    <>
      <GroupCard
        id={section.key}
        dragData={sectionDragDataFor(section)}
        disabled={isSortableDisabled(section)}
        title={section.title}
        count={count}
        accent={accent}
        icon={chevron}
        onToggle={onToggle}
        mediaIndicator={mediaIndicator}
        action={headerAction}
        // 「×」= 整批关闭该分组的全部标签（一次撤销批次，可一键找回）。
        // 开了「自动分组同步为原生组」的用户，域名分组实际是 native 组
        // （标题即域名）——只挂 site 会让这批用户完全找不到入口。
        // 关闭组内全部标签后空组由浏览器回收，不额外解散浏览器分组结构。
        onClose={
          rowProps.callbacks.onCloseSection
            ? () => rowProps.callbacks.onCloseSection?.(section)
            : undefined
        }
        // 影响面写进 title/aria-label：整批关闭是分区头唯一的破坏性操作，
        // 只写「关闭该域名的全部标签」而无数量时，误点等于一次关掉整个分组。
        // 让用户在点之前就知道会关掉几个（可撤销，故只需数量预览不需二次确认）。
        closeTitle={t(
          section.kind === 'site'
            ? '关闭该域名的全部 {{count}} 个标签（可撤销）'
            : '关闭该分组的全部 {{count}} 个标签（可撤销）',
          { count }
        )}
        collapsed={isCollapsed}
      >
        {isCollapsed ? null : renderBody()}
      </GroupCard>
      {/* 弹窗必须脱离 GroupCard 的折叠闸门（{!collapsed && children}）：
          不脱离则折叠时点「编辑」无任何反应（弹窗不挂载），展开后弹窗还会
          「僵尸弹出」——状态在闸门外、渲染在闸门内所致（FolderRow 同型坑）。
          弹窗经 DialogShell portal 到 body，DOM 位置不影响显示。 */}
      {section.kind === 'native' && editOpen && (
        <GroupEditDialog
          title={section.title}
          color={section.color}
          onRename={(name) => rowProps.callbacks.onGroupRename(section.groupId, name)}
          onRecolor={(color) => rowProps.callbacks.onGroupRecolor(section.groupId, color)}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
});
