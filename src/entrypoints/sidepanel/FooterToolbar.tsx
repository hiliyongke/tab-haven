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
  quickRegrouping: boolean;
  activeTabId: number | undefined;
  /** 休眠中的标签数（>0 时显示唤醒全部按钮）。 */
  discardedCount: number;
  /** 撤销栈中可恢复的批次数量（>0 时护盾显示计数，强化「一切可反悔」的信任感）。 */
  undoBatchCount: number;
  /** 会话快照数量（>0 时快照按钮提示可恢复）。 */
  snapshotCount: number;
  onToggleAllSections: () => void;
  onDiscardInactive: () => void;
  onWakeAll: () => void;
  onQuickRegroup: () => void;
  onLocateActive: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenSnapshots: () => void;
  onOpenPalette: () => void;
}

/** 功能组之间的细分隔线（与设置前的分隔线同款，帮助用户按组理解图标语义）。 */
function GroupDivider() {
  return <span className="mx-0.5 h-3.5 w-px shrink-0 bg-gray-200" aria-hidden="true" />;
}

export function FooterToolbar(props: FooterToolbarProps) {
  const { t } = useTranslation();
  const {
    tabCount,
    collapsibleCount,
    allCollapsed,
    quickRegrouping,
    activeTabId,
    discardedCount,
    undoBatchCount,
    snapshotCount,
    onToggleAllSections,
    onDiscardInactive,
    onWakeAll,
    onQuickRegroup,
    onLocateActive,
    onOpenHistory,
    onOpenSnapshots,
    onOpenSettings,
    onOpenPalette
  } = props;

  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-gray-200 px-2.5 py-0.5 text-2xs text-gray-500">
      <span className="whitespace-nowrap">
        {t('tabs.currentOpen')} <strong>{tabCount}</strong> {t('tabs.tabCountUnit')}
      </span>
      <nav className="flex items-center gap-1" aria-label={t('footer.utilityLabel')}>
        {/* 组 1 · 视图与组织：命令面板 / 折叠全部 / 快速整理 / 定位 */}
        <IconButton icon={Icons.shortcuts} title={t('palette.open')} onClick={onOpenPalette} />
        <IconButton
          icon={allCollapsed ? Icons.expandAll : Icons.collapseAll}
          title={t(allCollapsed ? 'footer.expandAll' : 'footer.collapseAll')}
          disabled={collapsibleCount === 0}
          onClick={onToggleAllSections}
        />
        <IconButton
          icon={Icons.quickRegroup}
          title={t('footer.quickRegroupHint')}
          disabled={quickRegrouping}
          onClick={onQuickRegroup}
        />
        <IconButton
          icon={Icons.locate}
          title={t('tabs.locateActive')}
          disabled={activeTabId === undefined}
          onClick={onLocateActive}
        />
        <GroupDivider />
        {/* 组 2 · 内存管理：休眠全部 / 唤醒全部（条件出现） */}
        <IconButton
          icon={Icons.snowflake}
          title={t('discard.allInactive')}
          onClick={onDiscardInactive}
        />
        {discardedCount > 0 && (
          <IconButton icon={Icons.wakeAll} title={t('discard.wakeAll')} onClick={onWakeAll} />
        )}
        <GroupDivider />
        {/* 组 3 · 记录与恢复：快照空间 / 撤销历史（均带计数徽章） */}
        <IconButton
          icon={Icons.snapshot}
          title={t('snapshots.title')}
          badge={snapshotCount > 0 ? snapshotCount : undefined}
          onClick={onOpenSnapshots}
        />
        {/* 撤销栈非空时把安全网文案接入 title（强化「一切可反悔」信任感），
            为空时退回普通「撤销历史」说明。 */}
        <IconButton
          icon={Icons.history}
          title={
            undoBatchCount > 0
              ? t('safety.shieldTitle', { count: undoBatchCount })
              : t('undo.historyTitle')
          }
          badge={undoBatchCount > 0 ? undoBatchCount : undefined}
          onClick={onOpenHistory}
        />
        <GroupDivider />
        <IconButton
          icon={Icons.settings}
          title={t('settings.title')}
          box="md"
          tone="accent"
          onClick={onOpenSettings}
        />
      </nav>
    </footer>
  );
}
