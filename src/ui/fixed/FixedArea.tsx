import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { ConfirmDialog, PromptDialog } from '@/ui/dialog/Dialog';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { TAB_DRAG_MIME } from '@/ui/tabs/TabRow';

export const LOCATE_TAB_EVENT = 'tabhaven:locate-tab';

/** 固定条目行：站点图标 + 标题 + 挂起态 + 悬停关闭。 */
function FolderItemRow({ folder, item }: { folder: FixedFolder; item: FixedFolderItem }) {
  const { t } = useTranslation();
  const openSavedItem = useDataStore((state) => state.openSavedItem);
  const removeFolderItem = useDataStore((state) => state.removeFolderItem);
  const tabs = useTabStore((state) => state.tabs);

  const isOpen = item.pendingTabId !== undefined || tabs.some((tab) => tab.url === item.url);
  const runtimeTab = item.pendingTabId !== undefined
    ? tabs.find((tab) => tab.id === item.pendingTabId)
    : tabs.find((tab) => tab.url === item.url);
  const isActive = runtimeTab?.active ?? false;

  return (
    <li
      role="listitem"
      data-tabhaven-tab-id={runtimeTab?.id}
      className={
        'folder-item group' +
        (isOpen ? ' is-open' : ' is-closed') +
        (isActive ? ' is-active' : '')
      }
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-folder-item', `${folder.id}:${item.id}`);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('application/x-folder-item')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        event.currentTarget.classList.toggle('is-drop-before', !after);
        event.currentTarget.classList.toggle('is-drop-after', after);
      }}
      onDragLeave={(event) => {
        event.currentTarget.classList.remove('is-drop-before', 'is-drop-after');
      }}
      onDrop={(event) => {
        event.currentTarget.classList.remove('is-drop-before', 'is-drop-after');
        const payload = event.dataTransfer.getData('application/x-folder-item');
        if (!payload) return;
        const [sourceFolderId, sourceItemId] = payload.split(':');
        if (sourceFolderId === folder.id && sourceItemId === item.id) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const placeAfter = event.clientY > rect.top + rect.height / 2;
        if (sourceFolderId === folder.id) {
          // 同文件夹内排序
          void useDataStore
            .getState()
            .reorderFolderItems(folder.id, sourceItemId ?? '', item.id, placeAfter);
        }
      }}
    >
      <button
        type="button"
        className="fixed-item-main"
        onClick={() => void openSavedItem(item)}
        title={item.title || item.url}
      >
        <span className="fixed-item-favicon">
          {item.pendingTabId !== undefined ? (
            <span className="fixed-item-pending" aria-hidden="true" />
          ) : (
            <Favicon src={item.favIconUrl} title={item.title} size={16} />
          )}
        </span>
        <span className="fixed-item-title truncate">{item.title || t('tabs.newTab')}</span>
      </button>
      <button
        type="button"
        className="fixed-item-remove"
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
    </li>
  );
}

/** 固定文件夹：折叠头 + 条目列表。 */
function FolderRow({ folder }: { folder: FixedFolder }) {
  const { t } = useTranslation();
  const renameFolder = useDataStore((state) => state.renameFolder);
  const deleteFolder = useDataStore((state) => state.deleteFolder);
  const toggleFolderCollapsed = useDataStore((state) => state.toggleFolderCollapsed);
  const addTabToFolder = useDataStore((state) => state.addTabToFolder);
  const moveFolder = useDataStore((state) => state.moveFolder);
  const onRestoreFolderAsGroup = useDataStore((state) => state.syncFolderToNativeGroup);
  const notify = useUndoStore((state) => state.notify);
  const tabs = useTabStore((state) => state.tabs);
  const [dialog, setDialog] = useState<
    { type: 'rename' } | { type: 'delete' } | { type: 'convert' } | null
  >(null);

  useEffect(() => {
    const handleLocate = (event: Event) => {
      const tabId = (event as CustomEvent<number>).detail;
      if (!Number.isInteger(tabId)) return;
      const belongsToFolder = tabs.some(
        (tab) => tab.id === tabId && folder.items.some((item) => item.url === tab.url || item.pendingTabId === tab.id)
      );
      if (folder.collapsed && belongsToFolder) void toggleFolderCollapsed(folder.id);
    };
    window.addEventListener(LOCATE_TAB_EVENT, handleLocate);
    return () => window.removeEventListener(LOCATE_TAB_EVENT, handleLocate);
  }, [folder.collapsed, folder.id, folder.items, tabs, toggleFolderCollapsed]);

  return (
    <section
      className="fixed-folder"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(TAB_DRAG_MIME)) event.preventDefault();
      }}
      onDrop={(event) => {
        const tabId = Number(event.dataTransfer.getData(TAB_DRAG_MIME));
        if (!Number.isInteger(tabId)) return;
        event.preventDefault();
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (tab) void addTabToFolder(tab, folder.id);
      }}
    >
      <div className="fixed-folder-head group" draggable onDragStart={(event) => {
        event.dataTransfer.setData('application/x-folder-id', folder.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('application/x-folder-id')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        const sourceId = event.dataTransfer.getData('application/x-folder-id');
        if (!sourceId || sourceId === folder.id) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const placeAfter = event.clientY > rect.top + rect.height / 2;
        void moveFolder(sourceId, folder.id, placeAfter);
      }}>
        <button
          type="button"
          className="fixed-folder-toggle"
          onClick={() => void toggleFolderCollapsed(folder.id)}
        >
          <Icon d={Icons.chevron} className={'fixed-folder-chevron' + (folder.collapsed ? '' : ' is-expanded')} />
          <span className="fixed-folder-name truncate">{folder.name}</span>
          <span className="fixed-folder-count">{folder.items.length}</span>
        </button>
        <span className="fixed-folder-actions">
          <button
            type="button"
            className="fixed-folder-action is-restore"
            title={t('fixed.toNativeGroup')}
            aria-label={t('fixed.toNativeGroup')}
            onClick={() => setDialog({ type: 'convert' })}
          >
            <Icon d={Icons.group} className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="fixed-folder-action"
            title={t('fixed.rename')}
            aria-label={t('fixed.rename')}
            onClick={() => setDialog({ type: 'rename' })}
          >
            <Icon d={Icons.pencil} className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="fixed-folder-action is-danger"
            title={t('fixed.delete')}
            aria-label={t('fixed.delete')}
            onClick={() => setDialog({ type: 'delete' })}
          >
            <Icon d={Icons.close} className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {!folder.collapsed && (
        <ul className="fixed-folder-items">
          {folder.items.map((item) => (
            <FolderItemRow key={item.id} folder={folder} item={item} />
          ))}
        </ul>
      )}
      {dialog?.type === 'rename' && (
        <PromptDialog
          title={t('fixed.renamePrompt')}
          initialValue={folder.name}
          onConfirm={(name) => {
            void renameFolder(folder.id, name);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title={t('fixed.delete')}
          message={t('fixed.deleteConfirm', { name: folder.name })}
          danger
          onConfirm={() => {
            void deleteFolder(folder.id);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
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
    </section>
  );
}

/** 固定空间区域：header（折叠/新建）+ 文件夹列表。 */
export function FixedArea() {
  const { t } = useTranslation();
  const folders = useDataStore((state) => state.folders);
  const createFolder = useDataStore((state) => state.createFolder);
  const [creating, setCreating] = useState(false);

  return (
    <section className="fixed-area" aria-label={t('fixed.areaLabel')}>
      <div className="fixed-area-head">
        <span className="fixed-area-title">
          <span>{t('fixed.areaTitle')}</span>
          <span className="fixed-area-count">{folders.length}</span>
        </span>
        <button
          type="button"
          className="fixed-area-add"
          title={t('fixed.newFolder')}
          aria-label={t('fixed.newFolder')}
          onClick={() => setCreating(true)}
        >
          <Icon d={Icons.plus} className="h-3.5 w-3.5" />
          <span className="sr-only">{t('fixed.newFolder')}</span>
        </button>
      </div>
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
    </section>
  );
}
