import { useTranslation } from 'react-i18next';
import { IconButton } from '@/ui/common/IconButton';
import { Icons } from '@/ui/common/Icon';

/**
 * 底部工具区：标签计数 + 折叠/批量休眠/唤醒/快速整理/定位/缩放/历史/设置。
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
  onToggleAllSections: () => void;
  onDiscardInactive: () => void;
  onWakeAll: () => void;
  onQuickRegroup: () => void;
  onLocateActive: () => void;
  onResetZoom: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
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
    onToggleAllSections,
    onDiscardInactive,
    onWakeAll,
    onQuickRegroup,
    onLocateActive,
    onResetZoom,
    onOpenHistory,
    onOpenSettings
  } = props;

  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-gray-200 px-2.5 py-0.5 text-2xs text-gray-500">
      <span className="whitespace-nowrap">
        {t('tabs.currentOpen')} <strong>{tabCount}</strong> {t('tabs.tabCountUnit')}
      </span>
      <nav className="flex items-center gap-1" aria-label={t('footer.utilityLabel')}>
        <IconButton
          icon={allCollapsed ? Icons.expandAll : Icons.collapseAll}
          title={t(allCollapsed ? 'footer.expandAll' : 'footer.collapseAll')}
          disabled={collapsibleCount === 0}
          onClick={onToggleAllSections}
        />
        <IconButton
          icon={Icons.snowflake}
          title={t('discard.allInactive')}
          onClick={onDiscardInactive}
        />
        {discardedCount > 0 && (
          <IconButton
            icon={Icons.wakeAll}
            title={t('discard.wakeAll')}
            onClick={onWakeAll}
          />
        )}
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
        <IconButton
          icon={Icons.zoomReset}
          title={t('discard.zoomReset')}
          onClick={onResetZoom}
        />
        <IconButton
          icon={Icons.history}
          title={t('undo.historyTitle')}
          onClick={onOpenHistory}
        />
        <span className="ml-1 flex items-center border-l border-gray-200 pl-1">
          <IconButton
            icon={Icons.settings}
            title={t('settings.title')}
            box="md"
            tone="accent"
            onClick={onOpenSettings}
          />
        </span>
      </nav>
    </footer>
  );
}
