import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { saveFolderToBookmarks } from '@/platform/bookmarks';
import { createTabsWithUrls } from '@/platform/tabs';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { ConfirmDialog, PromptDialog } from '@/ui/dialog/Dialog';
import { FolderEditDialog } from '@/ui/fixed/FolderEditDialog';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { GroupCard } from '@/ui/common/GroupCard';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowActions } from '@/ui/common/RowActions';
import { RowItem } from '@/ui/common/RowItem';
import { StatusBadges } from '@/ui/common/StatusBadges';
import { DragType, FIXED_AREA_DROPPABLE } from '@/ui/dnd/types';

export const LOCATE_TAB_EVENT = 'tabhaven:locate-tab';
/** App 层请求固定空间弹出「新建文件夹」命名弹窗（拖标签/分组到空白区时触发）。 */
export const CREATE_FOLDER_REQUEST_EVENT = 'tabhaven:create-folder-request';

interface CreateFolderRequest {
  name: string;
  tabIds: number[];
}

/** 固定条目行：复用分组标签行（row-item）的视觉与交互，排序用全局 dnd-kit。 */
function FolderItemRow({ folder, item }: { folder: FixedFolder; item: FixedFolderItem }) {
  const { t } = useTranslation();
  const openSavedItem = useDataStore((state) => state.openSavedItem);
  const removeFolderItem = useDataStore((state) => state.removeFolderItem);
  const toggleMute = useTabStore((state) => state.toggleMute);
  const discardTab = useTabStore((state) => state.discardTab);
  const tabs = useTabStore((state) => state.tabs);

  const isOpen = item.pendingTabId !== undefined || tabs.some((tab) => tab.url === item.url);
  const runtimeTab = item.pendingTabId !== undefined
    ? tabs.find((tab) => tab.id === item.pendingTabId)
    : tabs.find((tab) => tab.url === item.url);
  const isActive = runtimeTab?.active ?? false;

  // 固定条目始终可排序（无论是否打开），不再用 isOpen 禁用。
  const sortable = useSortable({
    id: item.id,
    data: {
      type: DragType.FolderItem,
      folderId: folder.id,
      itemId: item.id,
      title: item.title || '',
      favIconUrl: item.favIconUrl
    }
  });

  return (
    <li data-tabhaven-tab-id={runtimeTab?.id}>
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
            {runtimeTab && !runtimeTab.discarded && !runtimeTab.active && canSafelyDiscardTab(runtimeTab) && (
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
              className="row-action text-red-500"
              title={t('fixed.itemClose')}
              aria-label={t('fixed.itemClose')}
              onClick={() => {
                const allTabs = useTabStore.getState().tabs;
                const targetTab = item.pendingTabId !== undefined
                  ? allTabs.find((tab) => tab.id === item.pendingTabId)
                  : allTabs.find((tab) => tab.url === item.url);
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
          listeners: sortable.listeners,
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
}

/** 固定文件夹：复用分组卡片（section-card + SectionHead）的视觉与交互。 */
function FolderRow({ folder }: { folder: FixedFolder }) {
  const { t } = useTranslation();
  const renameFolder = useDataStore((state) => state.renameFolder);
  const deleteFolder = useDataStore((state) => state.deleteFolder);
  const toggleFolderCollapsed = useDataStore((state) => state.toggleFolderCollapsed);
  const onRestoreFolderAsGroup = useDataStore((state) => state.syncFolderToNativeGroup);
  const notify = useUndoStore((state) => state.notify);
  const tabs = useTabStore((state) => state.tabs);
  const [dialog, setDialog] = useState<
    { type: 'edit' } | { type: 'convert' } | null
  >(null);

  useEffect(() => {
    const handleLocate = (event: Event) => {
      const tabId = (event as CustomEvent<number>).detail;
      if (!Number.isInteger(tabId)) return;
      const belongsToFolder = tabs.some(
        (tab) =>
          tab.id === tabId &&
          folder.items.some((item) => item.url === tab.url || item.pendingTabId === tab.id)
      );
      if (folder.collapsed && belongsToFolder) void toggleFolderCollapsed(folder.id);
    };
    window.addEventListener(LOCATE_TAB_EVENT, handleLocate);
    return () => window.removeEventListener(LOCATE_TAB_EVENT, handleLocate);
  }, [folder.collapsed, folder.id, folder.items, tabs, toggleFolderCollapsed]);

  // 文件夹排序（dnd-kit）：SortableContext 在外层 FixedArea，条目 SortableContext 在本层。
  const folderDragData = {
    type: DragType.Folder,
    folderId: folder.id,
    name: folder.name
  } as const;

  // 头部操作：与原生组同款布局 [打开全部 / 存为书签 / 转原生组 / 编辑]，删除整合到 FolderEditDialog。
  const handleOpenAll = () => {
    const missing = folder.items.filter(
      (item) => item.url && item.pendingTabId === undefined &&
        !tabs.some((tab) => tab.url === item.url && !tab.incognito)
    );
    if (missing.length === 0) {
      notify(t('fixed.allOpen'));
      return;
    }
    void createTabsWithUrls(missing.map((item) => item.url))
      .then(() => notify(t('fixed.openedAll', { count: missing.length })))
      .catch(() => notify(t('errors.operationFailed')));
  };
  const handleExportBookmarks = () => {
    void saveFolderToBookmarks(folder)
      .then((count) => notify(count > 0 ? t('fixed.bookmarked', { count }) : t('fixed.bookmarkEmpty')))
      .catch(() => notify(t('errors.operationFailed')));
  };
  const headerAction = (
    <>
      <button
        type="button"
        className="row-action"
        title={t('fixed.openAll')}
        aria-label={t('fixed.openAll')}
        onClick={(event) => {
          event.stopPropagation();
          handleOpenAll();
        }}
      >
        <Icon d={Icons.openAll} className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="row-action"
        title={t('fixed.toBookmarks')}
        aria-label={t('fixed.toBookmarks')}
        onClick={(event) => {
          event.stopPropagation();
          handleExportBookmarks();
        }}
      >
        <Icon d={Icons.bookmarkAdd} className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="row-action"
        title={t('fixed.toNativeGroup')}
        aria-label={t('fixed.toNativeGroup')}
        onClick={(event) => {
          event.stopPropagation();
          setDialog({ type: 'convert' });
        }}
      >
        <Icon d={Icons.toNativeGroup} className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="row-action"
        title={t('fixed.edit')}
        aria-label={t('fixed.edit')}
        onClick={(event) => {
          event.stopPropagation();
          setDialog({ type: 'edit' });
        }}
      >
        <Icon d={Icons.pencil} className="h-3.5 w-3.5" />
      </button>
    </>
  );

  return (
    <GroupCard
      id={`folder:${folder.id}`}
      dragData={folderDragData}
      title={folder.name}
      count={folder.items.length}
      accent="var(--c-brand-500)"
      icon={
        <Icon
          d={Icons.chevron}
          className={'icon h-3.5 w-3.5 transition-transform' + (folder.collapsed ? '' : ' rotate-90')}
        />
      }
      onToggle={() => void toggleFolderCollapsed(folder.id)}
      action={headerAction}
      collapsed={folder.collapsed}
    >
      {!folder.collapsed && (
        <SortableContext
          items={folder.items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="section-body-list">
            {folder.items.map((item) => (
              <FolderItemRow key={item.id} folder={folder} item={item} />
            ))}
          </ul>
        </SortableContext>
      )}
      {dialog?.type === 'edit' && (
        <FolderEditDialog
          initialName={folder.name}
          onRename={(name) => {
            void renameFolder(folder.id, name);
          }}
          onDelete={() => {
            void deleteFolder(folder.id);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'convert' && (
        <ConfirmDialog
          title={t('fixed.convertTitle')}
          message={t('fixed.convertConfirm', { name: folder.name })}
          danger
          onConfirm={() => {
            setDialog(null);
            void onRestoreFolderAsGroup(folder.id)
              .then((converted) =>
                notify(t(converted ? 'toast.folderConverted' : 'toast.folderConvertSkipped'))
              )
              .catch(() => notify(t('toast.folderConvertFailed')));
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </GroupCard>
  );
}

/** 固定空间区域：header（折叠/新建）+ 文件夹列表（复用分组卡片视觉），
 *  整体是 useDroppable 目标（拖标签/分组到空白处创建新文件夹）。 */
export function FixedArea() {
  const { t } = useTranslation();
  const folders = useDataStore((state) => state.folders);
  const createFolder = useDataStore((state) => state.createFolder);
  const addTabsToFolder = useDataStore((state) => state.addTabsToFolder);
  const notify = useUndoStore((state) => state.notify);
  const tabs = useTabStore((state) => state.tabs);
  const [creating, setCreating] = useState(false);
  const [dropRequest, setDropRequest] = useState<CreateFolderRequest | null>(null);
  const { isOver, setNodeRef } = useDroppable({
    id: FIXED_AREA_DROPPABLE,
    data: { type: 'fixed-area' }
  });

  useEffect(() => {
    const handleCreateRequest = (event: Event) => {
      const detail = (event as CustomEvent<CreateFolderRequest>).detail;
      if (!detail || !detail.name || !Array.isArray(detail.tabIds) || detail.tabIds.length === 0) return;
      setDropRequest(detail);
    };
    window.addEventListener(CREATE_FOLDER_REQUEST_EVENT, handleCreateRequest);
    return () => window.removeEventListener(CREATE_FOLDER_REQUEST_EVENT, handleCreateRequest);
  }, []);

  const handleConfirmDrop = (name: string) => {
    const request = dropRequest;
    setDropRequest(null);
    if (!request) return;
    const targetTabs = tabs.filter((tab) => request.tabIds.includes(tab.id));
    void (async () => {
      const folder = await createFolder(name);
      await addTabsToFolder(targetTabs, folder.id);
    })().catch(() => notify(t('errors.operationFailed')));
  };

  return (
    <SortableContext
      items={folders.map((folder) => `folder:${folder.id}`)}
      strategy={verticalListSortingStrategy}
    >
      <CategoryModule
        title={t('fixed.areaTitle')}
        count={folders.length}
        aria-label={t('fixed.areaLabel')}
        className="module-shell fixed-area"
        setNodeRef={setNodeRef}
        isOver={isOver}
        action={
          <button
            type="button"
            className="row-action"
            title={t('fixed.newFolder')}
            aria-label={t('fixed.newFolder')}
            onClick={() => setCreating(true)}
          >
            <Icon d={Icons.plus} className="h-3.5 w-3.5" />
            <span className="sr-only">{t('fixed.newFolder')}</span>
          </button>
        }
      >
        {folders.length === 0 && (
          <p className="fixed-area-empty">{t('fixed.emptyHint')}</p>
        )}
        {folders.map((folder) => (
          <FolderRow key={folder.id} folder={folder} />
        ))}
        {creating && (
          <PromptDialog
            title={t('fixed.newFolderPrompt')}
            onConfirm={(name) => {
              void createFolder(name);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        )}
        {dropRequest && (
          <PromptDialog
            title={t('fixed.newFolderPrompt')}
            initialValue={dropRequest.name}
            onConfirm={handleConfirmDrop}
            onCancel={() => setDropRequest(null)}
          />
        )}
      </CategoryModule>
    </SortableContext>
  );
}
