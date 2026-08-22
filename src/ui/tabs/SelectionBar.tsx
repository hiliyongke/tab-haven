import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { Icon, Icons } from '@/ui/common/Icon';

/** 自绘下拉菜单，替换原生 <select>，保持侧栏视觉一致、可键盘关闭。 */
function FolderDropdown({
  folders,
  label,
  onSelect,
}: {
  folders: { id: string; name: string }[];
  label: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-base hover:bg-gray-100"
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon d={Icons.pin} className="mr-1 inline h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-60 w-44 overflow-auto rounded-lg border border-gray-200 bg-surface py-1 shadow-lg">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 transition-base hover:bg-gray-100"
              onClick={() => {
                onSelect(folder.id);
                setOpen(false);
              }}
            >
              {folder.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const notify = useUndoStore((state) => state.notify);
  const toggleMute = useTabStore((state) => state.toggleMute);
  const togglePinned = useTabStore((state) => state.togglePinned);
  const folders = useDataStore((state) => state.folders);
  const addTabToFolder = useDataStore((state) => state.addTabToFolder);

  if (!active) return null;

  const selected = tabs.filter((tab) => selectedIds.includes(tab.id));
  const count = selected.length;

  const runBatch = async (tasks: Array<() => Promise<void>>) => {
    let succeeded = 0;
    let failed = 0;
    for (const task of tasks) {
      try {
        await task();
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    if (succeeded > 0 || failed > 0) {
      notify(t('selection.batchComplete', { count: succeeded, failed }));
    }
    exitSelectionMode();
  };

  const handleClose = () => {
    if (selected.length === 0) return;
    void closeWithUndo(tabs, selected.map((tab) => tab.id));
    exitSelectionMode();
  };

  const handlePin = () => {
    void runBatch(selected.filter((tab) => !tab.pinned).map((tab) => () => togglePinned(tab)));
  };

  const handleMute = () => {
    void runBatch(selected.map((tab) => () => toggleMute(tab)));
  };

  const handleMoveToFolder = (folderId: string) => {
    void runBatch(selected.map((tab) => () => addTabToFolder(tab, folderId)));
  };

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-gray-200 bg-surface px-3 py-2">
      <span className="text-xs text-gray-500">
        {t('selection.count', { count })}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        className="rounded px-2 py-1 text-xs text-gray-600 transition-base hover:bg-gray-100"
        title={t('selection.close')}
        onClick={handleClose}
      >
        <Icon d={Icons.close} className="mr-1 inline h-3.5 w-3.5" />
        {t('selection.closeAction')}
      </button>
      <button
        type="button"
        className="rounded px-2 py-1 text-xs text-gray-600 transition-base hover:bg-gray-100"
        title={t('selection.pin')}
        onClick={handlePin}
      >
        <Icon d={Icons.pin} className="mr-1 inline h-3.5 w-3.5" />
        {t('selection.pinAction')}
      </button>
      <button
        type="button"
        className="rounded px-2 py-1 text-xs text-gray-600 transition-base hover:bg-gray-100"
        title={t('selection.mute')}
        onClick={handleMute}
      >
        <Icon d={Icons.mute} className="mr-1 inline h-3.5 w-3.5" />
        {t('selection.muteAction')}
      </button>
      {folders.length > 0 && (
        <FolderDropdown
          folders={folders}
          label={t('selection.moveToFolder')}
          onSelect={handleMoveToFolder}
        />
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
