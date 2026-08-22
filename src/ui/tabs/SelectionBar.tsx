import { useTranslation } from 'react-i18next';
import type { TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 批量操作条（FR-D1.1）：选中集的操作入口。
 * 批量关闭/固定/静音/移入文件夹；全部执行后退出选择模式。
 */
export function SelectionBar({ tabs }: { tabs: readonly TabRecord[] }) {
  const { t } = useTranslation();
  const active = useSelectionStore((state) => state.active);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const exitSelectionMode = useSelectionStore((state) => state.exitSelectionMode);
  const clear = useSelectionStore((state) => state.clear);

  const closeWithUndo = useUndoStore((state) => state.closeWithUndo);
  const toggleMute = useTabStore((state) => state.toggleMute);
  const togglePinned = useTabStore((state) => state.togglePinned);
  const folders = useDataStore((state) => state.folders);
  const addTabToFolder = useDataStore((state) => state.addTabToFolder);

  if (!active) return null;

  const selected = tabs.filter((tab) => selectedIds.includes(tab.id));
  const count = selected.length;

  const handleClose = () => {
    if (selected.length === 0) return;
    void closeWithUndo(tabs, selected.map((tab) => tab.id));
    exitSelectionMode();
  };

  const handlePin = () => {
    for (const tab of selected.filter((tab) => !tab.pinned)) {
      void togglePinned(tab);
    }
    exitSelectionMode();
  };

  const handleMute = () => {
    for (const tab of selected) {
      void toggleMute(tab);
    }
    exitSelectionMode();
  };

  const handleMoveToFolder = (folderId: string) => {
    for (const tab of selected) {
      void addTabToFolder(tab, folderId);
    }
    exitSelectionMode();
  };

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-gray-200 bg-white px-3 py-2">
      <span className="text-xs text-gray-500">
        {t('selection.count', { count })}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
        title={t('selection.close')}
        onClick={handleClose}
      >
        <Icon d={Icons.close} className="mr-1 inline h-3.5 w-3.5" />
        {t('selection.closeAction')}
      </button>
      <button
        type="button"
        className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
        title={t('selection.pin')}
        onClick={handlePin}
      >
        <Icon d={Icons.pin} className="mr-1 inline h-3.5 w-3.5" />
        {t('selection.pinAction')}
      </button>
      <button
        type="button"
        className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
        title={t('selection.mute')}
        onClick={handleMute}
      >
        <Icon d={Icons.mute} className="mr-1 inline h-3.5 w-3.5" />
        {t('selection.muteAction')}
      </button>
      {folders.length > 0 && (
        <select
          className="rounded border border-gray-200 px-1 py-1 text-xs text-gray-600"
          value=""
          title={t('selection.moveToFolder')}
          onChange={(event) => {
            if (event.target.value) handleMoveToFolder(event.target.value);
          }}
        >
          <option value="" disabled>
            {t('selection.moveToFolder')}
          </option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="rounded p-1 text-gray-400 hover:bg-gray-100"
        title={t('selection.cancel')}
        onClick={() => {
          clear();
          exitSelectionMode();
        }}
      >
        <Icon d={Icons.close} className="h-4 w-4" />
      </button>
    </div>
  );
}
