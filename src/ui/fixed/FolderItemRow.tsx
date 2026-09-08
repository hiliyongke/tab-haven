import { memo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';
import { canSafelyDiscardTab, type TabRecord } from '@/core/tab-types';

/** 固定条目行的运行时状态（由 FolderRow 一次性建索引下传，避免每行各自扫全量标签）。 */
export interface FolderItemRuntime {
  isOpen: boolean;
  runtimeTab?: TabRecord;
}
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowActions } from '@/ui/common/RowActions';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import { RowItem } from '@/ui/common/RowItem';
import { StatusBadges } from '@/ui/common/StatusBadges';
import { DragType } from '@/ui/dnd/types';

/** 固定条目行：复用分组标签行（row-item）的视觉与交互，排序用全局 dnd-kit。
 *  运行时状态（isOpen / runtimeTab）由 FolderRow 建索引后下传；本组件纯 memo 叶子，
 *  不再订阅 tabs，避免每个条目各自扫全量标签（O(条目×标签) 退化为 O(标签+条目)）。 */
export const FolderItemRow = memo(function FolderItemRow({
  folder,
  item,
  runtime,
  importing
}: {
  folder: FixedFolder;
  item: FixedFolderItem;
  runtime: FolderItemRuntime;
  /** 导入事务进行中：本行的写操作（移出文件夹）会被丢弃，禁用入口。 */
  importing: boolean;
}) {
  const { t } = useTranslation();
  const openSavedItem = useDataStore((state) => state.openSavedItem);
  const removeFolderItem = useDataStore((state) => state.removeFolderItem);
  const toggleMute = useTabStore((state) => state.toggleMute);
  const discardTab = useTabStore((state) => state.discardTab);

  const runtimeTab = runtime.runtimeTab;
  const isOpen = runtime.isOpen;
  const isActive = runtimeTab?.active ?? false;

  // 固定条目始终可排序（无论是否打开），不再用 isOpen 禁用。
  const sortable = useSortable({
    id: item.id,
    // 同 TabRow：关掉让位过渡，避免动画期间矩形漂移导致落点不准。
    transition: null,
    data: {
      type: DragType.FolderItem,
      folderId: folder.id,
      itemId: item.id,
      title: item.title || '',
      favIconUrl: item.favIconUrl
    }
  });
  // 同 TabRow：键盘监听挂主按钮，指针监听挂整行（避免同一事件双重激活）。
  const { onKeyDown: sortableKeyDown, ...sortablePointerListeners } = sortable.listeners ?? {};

  return (
    <li data-tabs-tab-id={runtimeTab?.id}>
      <RowItem
        faviconSrc={item.favIconUrl}
        faviconTitle={item.title}
        faviconFallback={
          item.pendingTabId !== undefined ? (
            <span className="relative inline-flex shrink-0 items-center justify-center">
              <span className="fixed-item-pending" aria-hidden="true" />
            </span>
          ) : null
        }
        isActive={isActive}
        isMediaPlaying={runtimeTab ? runtimeTab.audible && !runtimeTab.muted : false}
        isDropTarget={sortable.isOver}
        onClick={() => void openSavedItem(item)}
        buttonTitle={item.title || item.url}
        title={
          <span className={isOpen ? undefined : 'text-gray-500'}>
            {item.title || t('tabs.newTab')}
          </span>
        }
        badges={
          runtimeTab ? (
            <StatusBadges tab={runtimeTab} duplicateCount={1} isSplitCompanion={false} />
          ) : null
        }
        actions={
          <RowActions>
            {runtimeTab && (runtimeTab.audible || runtimeTab.muted) && (
              <button
                type="button"
                className="row-action"
                title={runtimeTab.muted ? t('tabs.unmute') : t('tabs.mute')}
                aria-label={runtimeTab.muted ? t('tabs.unmute') : t('tabs.mute')}
                onClick={() => void toggleMute(runtimeTab)}
              >
                <Icon d={runtimeTab.muted ? Icons.muted : Icons.mute} className="h-3.5 w-3.5" />
              </button>
            )}
            {runtimeTab &&
              !runtimeTab.discarded &&
              !runtimeTab.active &&
              canSafelyDiscardTab(runtimeTab) && (
                <button
                  type="button"
                  className="row-action"
                  title={t('tabs.discard')}
                  aria-label={t('tabs.discard')}
                  onClick={() => void discardTab(runtimeTab.id)}
                >
                  <Icon d={Icons.snowflake} className="h-3.5 w-3.5" />
                </button>
              )}
            <button
              type="button"
              className="row-action is-danger"
              title={t('fixed.itemClose')}
              aria-label={t('fixed.itemClose')}
              disabled={importing}
              onClick={() => {
                const allTabs = useTabStore.getState().tabs;
                const targetTab =
                  item.pendingTabId !== undefined
                    ? allTabs.find((tab) => tab.id === item.pendingTabId)
                    : allTabs.find((tab) => itemUrlMatchesTab(item.url, tab));
                if (targetTab) {
                  void useUndoStore.getState().closeWithUndo(allTabs, [targetTab.id]);
                }
                void removeFolderItem(folder.id, item.id);
              }}
            >
              <Icon d={Icons.close} className="h-3.5 w-3.5" />
            </button>
          </RowActions>
        }
        dragGripTitle={t('fixed.reorderItem')}
        container={{
          ref: sortable.setNodeRef,
          listeners: sortablePointerListeners,
          activatorRef: sortable.setActivatorNodeRef,
          buttonAttributes: sortable.attributes,
          buttonListeners: sortableKeyDown
            ? {
                onKeyDown: sortableKeyDown as (event: ReactKeyboardEvent<HTMLButtonElement>) => void
              }
            : undefined,
          style: {
            transform: sortable.transform
              ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
              : undefined,
            transition: sortable.transition
          },
          className: sortable.isDragging ? 'is-sorting' : undefined
        }}
      />
    </li>
  );
});
