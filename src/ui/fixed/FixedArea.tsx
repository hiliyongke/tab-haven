import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { ConfirmDialog, PromptDialog } from '@/ui/dialog/Dialog';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { TAB_DRAG_MIME } from '@/ui/tabs/TabRow';

/** 固定条目行：图标 + 标题 + 挂起态 + 悬停关闭。 */
function FolderItemRow({ folder, item }: { folder: FixedFolder; item: FixedFolderItem }) {
  const openSavedItem = useDataStore((state) => state.openSavedItem);
  const removeFolderItem = useDataStore((state) => state.removeFolderItem);
  const tabs = useTabStore((state) => state.tabs);

  const isOpen = item.pendingTabId !== undefined || tabs.some((tab) => tab.url === item.url);
  const isActive = item.pendingTabId !== undefined
    ? tabs.some((tab) => tab.id === item.pendingTabId && tab.active)
    : tabs.some((tab) => tab.url === item.url && tab.active);

  return (
    <article
      className={
        'group flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100' +
        (isOpen ? '' : ' opacity-60') +
        (isActive ? ' bg-gray-100' : '')
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
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => void openSavedItem(item)}
        title={item.title || item.url}
      >
        {item.pendingTabId !== undefined ? (
          <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-gray-300" aria-hidden="true" />
        ) : (
          <Favicon src={item.favIconUrl} title={item.title} size={16} />
        )}
        <span className="truncate">{item.title || '新标签页'}</span>
      </button>
      <button
        type="button"
        className="text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
        title="关闭标签并移出文件夹"
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
    </article>
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
  const tabs = useTabStore((state) => state.tabs);
  const [dialog, setDialog] = useState<{ type: 'rename' } | { type: 'delete' } | null>(null);

  return (
    <section
      className="mb-1"
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
      <div className="group flex items-center gap-1 px-2 py-1" draggable onDragStart={(event) => {
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
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium"
          onClick={() => void toggleFolderCollapsed(folder.id)}
        >
          <Icon d={Icons.chevron} className={'h-3 w-3 text-gray-400 ' + (folder.collapsed ? '' : 'rotate-90')} />
          <span className="truncate">{folder.name}</span>
          <span className="text-xs text-gray-400">{folder.items.length}</span>
        </button>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="row-action"
            title={t('fixed.rename')}
            onClick={() => setDialog({ type: 'rename' })}
          >
            <Icon d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="row-action hover:text-red-500"
            title={t('fixed.delete')}
            onClick={() => setDialog({ type: 'delete' })}
          >
            <Icon d={Icons.close} className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {!folder.collapsed && (
        <div>
          {folder.items.map((item) => (
            <FolderItemRow key={item.id} folder={folder} item={item} />
          ))}
        </div>
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
    <section className="border-b border-gray-100 py-1" aria-label={t('fixed.areaLabel')}>
      <div className="flex items-center gap-1 px-2 py-1">
        <span className="flex-1 text-xs font-semibold text-gray-500">{t('fixed.areaTitle')}</span>
        <button
          type="button"
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title={t('fixed.newFolder')}
          onClick={() => setCreating(true)}
        >
          <Icon d={Icons.plus} className="h-3.5 w-3.5" />
        </button>
      </div>
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
