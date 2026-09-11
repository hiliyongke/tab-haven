import { useTranslation } from 'react-i18next';
import { IconButton } from '@/ui/common/IconButton';
import { Icons } from '@/ui/common/Icon';

/**
 * 底部工具区：标签计数 + 三组快捷功能（视图组织 / 内存管理 / 记录恢复）+ 设置。
 * 从 sidepanel App 拆出，保持渲染层纯粹（逻辑由回调注入）。
 */
export interface FooterToolbarProps {
  tabCount: number;
  /** 可折叠分区数（原生组 + 站点组），为 0 时折叠按钮禁用。 */
  collapsibleCount: number;
  allCollapsed: boolean;
  activeTabId: number | undefined;
  /** 休眠中的标签数（>0 时显示唤醒全部按钮）。 */
  discardedCount: number;
  /** 可清理的重复标签数（>0 时显示清理重复入口，徽章显示待清理数）。 */
  duplicateCount: number;
  /** 浏览器多选（Ctrl+Click）的标签数（≥2 时显示批量关闭入口）。 */
  highlightedCount: number;
  /** 撤销栈中可恢复的批次数量（>0 时护盾显示计数，强化「一切可反悔」的信任感）。 */
  undoBatchCount: number;
  /** 会话快照数量（>0 时快照按钮提示可恢复）。 */
  snapshotCount: number;
  /** 重排进行中：期间禁用入口防重复触发。 */
  quickRegrouping: boolean;
  onToggleAllSections: () => void;
  onDiscardInactive: () => void;
  onWakeAll: () => void;
  /** 重排临时区分组（打散现有分组后按当前方式重新归拢，可撤销）。 */
  onQuickRegroup: () => void;
  /** 一键清理重复标签（保留每网址的激活/固定/最早者，可撤销）。 */
  onCleanDuplicates: () => void;
  /** 关闭浏览器多选的标签（Ctrl+Click 选中后批量关闭）。 */
  onCloseHighlighted: () => void;
  onLocateActive: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenSnapshots: () => void;
  /** 底部工具区文字模式：开启后图标旁显示功能名称。 */
  footerLabels: boolean;
  onOpenPalette: () => void;
}

/** 功能组之间的细分隔线（与设置前的分隔线同款，帮助用户按组理解图标语义）。 */
function GroupDivider() {
  // 间距交给 nav 的 gap 提供（此前 mx-0.5 在窄面板会把图标行挤到换行）。
  return <span className="h-3.5 w-px shrink-0 bg-gray-200" aria-hidden="true" />;
}

export function FooterToolbar(props: FooterToolbarProps) {
  const { t } = useTranslation();
  const {
    tabCount,
    collapsibleCount,
    allCollapsed,
    activeTabId,
    discardedCount,
    duplicateCount,
    highlightedCount,
    undoBatchCount,
    snapshotCount,
    quickRegrouping,
    onToggleAllSections,
    onDiscardInactive,
    onWakeAll,
    onQuickRegroup,
    onCleanDuplicates,
    onCloseHighlighted,
    onLocateActive,
    onOpenHistory,
    onOpenSnapshots,
    onOpenSettings,
    onOpenPalette,
    footerLabels
  } = props;

  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-gray-200 px-2.5 py-0.5 text-2xs text-gray-500">
      <span className="whitespace-nowrap">
        {t('tabs.currentOpen')} <strong>{tabCount}</strong> {t('tabs.tabCountUnit')}
      </span>
      <nav
        className="flex min-w-0 flex-wrap items-center gap-0.5"
        aria-label={t('footer.utilityLabel')}
      >
        {/* 组 1 · 视图与组织：命令面板 / 折叠全部 / 快速整理 / 定位 */}
        <IconButton
          icon={Icons.shortcuts}
          title={t('palette.open')}
          label={footerLabels ? t('footer.labelPalette') : undefined}
          onClick={onOpenPalette}
        />
        <IconButton
          icon={allCollapsed ? Icons.expandAll : Icons.collapseAll}
          title={t(allCollapsed ? 'footer.expandAll' : 'footer.collapseAll')}
          label={
            footerLabels
              ? t(allCollapsed ? 'footer.labelExpandAll' : 'footer.labelCollapseAll')
              : undefined
          }
          disabled={collapsibleCount === 0}
          onClick={onToggleAllSections}
        />
        {/* 重排分组：分组乱了之后唯一的一键修复入口 ——
            虽然低频，但价值不可替代（曾被下沉到命令面板，用户要求恢复常驻）。 */}
        <IconButton
          icon={Icons.quickRegroup}
          title={t('footer.quickRegroupHint')}
          label={footerLabels ? t('footer.labelQuickRegroup') : undefined}
          disabled={quickRegrouping}
          onClick={onQuickRegroup}
        />
        <IconButton
          icon={Icons.locate}
          title={t('tabs.locateActive')}
          label={footerLabels ? t('footer.labelLocate') : undefined}
          disabled={activeTabId === undefined}
          onClick={onLocateActive}
        />
        {/* 清理重复：仅在存在可清理项时出现（与「唤醒全部」同款条件出现模式），
            徽章直接显示待清理数量，点按即清理并进撤销栈。 */}
        {duplicateCount > 0 && (
          <IconButton
            icon={Icons.copyX}
            title={t('duplicates.cleanHint')}
            label={footerLabels ? t('footer.labelCleanDuplicates') : undefined}
            badge={duplicateCount}
            onClick={onCleanDuplicates}
          />
        )}
        {/* 关闭选中的标签：浏览器 Ctrl+Click 多选 ≥2 个时出现 ——
            此前多选只有视觉高亮、没有操作出口（半成品承诺）。 */}
        {highlightedCount >= 2 && (
          <IconButton
            icon={Icons.close}
            title={t('selection.closeSelected', { count: highlightedCount })}
            label={footerLabels ? t('footer.labelCloseSelected') : undefined}
            badge={highlightedCount}
            onClick={onCloseHighlighted}
          />
        )}
        <GroupDivider />
        {/* 组 2 · 内存管理：休眠全部 / 唤醒全部（条件出现） */}
        <IconButton
          icon={Icons.snowflake}
          title={t('discard.allInactive')}
          label={footerLabels ? t('footer.labelDiscard') : undefined}
          onClick={onDiscardInactive}
        />
        {discardedCount > 0 && (
          <IconButton
            icon={Icons.wakeAll}
            title={t('discard.wakeAll')}
            label={footerLabels ? t('footer.labelWake') : undefined}
            onClick={onWakeAll}
          />
        )}
        <GroupDivider />
        {/* 组 3 · 记录与恢复：快照空间 / 撤销历史（均带计数徽章） */}
        <IconButton
          icon={Icons.snapshot}
          title={t('snapshots.title')}
          label={footerLabels ? t('footer.labelSnapshots') : undefined}
          badge={snapshotCount > 0 ? snapshotCount : undefined}
          onClick={onOpenSnapshots}
        />
        <IconButton
          icon={Icons.history}
          title={
            undoBatchCount > 0
              ? t('safety.shieldTitle', { count: undoBatchCount })
              : t('undo.historyTitle')
          }
          label={footerLabels ? t('footer.labelHistory') : undefined}
          badge={undoBatchCount > 0 ? undoBatchCount : undefined}
          onClick={onOpenHistory}
        />
        <GroupDivider />
        <IconButton
          icon={Icons.settings}
          title={t('settings.title')}
          label={footerLabels ? t('footer.labelSettings') : undefined}
          box="md"
          tone="accent"
          onClick={onOpenSettings}
        />
      </nav>
    </footer>
  );
}
