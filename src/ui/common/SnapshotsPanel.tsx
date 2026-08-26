import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { DialogShell } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { formatTime } from '@/ui/common/format';

/**
 * 会话快照面板（D5.1/D5.2 + D7 归档中心 + 空间轻量化 + 竞品导入 + 本地周报）。
 * 把当前窗口存为命名快照/空间，归档关闭并留档，从 OneTab 导入，查看本地周报；
 * 恢复走 platform/restoreSnapshot，提示走 undoStore。
 */
export function SnapshotsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const snapshots = useSnapshotStore((state) => state.snapshots);
  const saveCurrentWindow = useSnapshotStore((state) => state.saveCurrentWindow);
  const saveSpace = useSnapshotStore((state) => state.saveSpace);
  const importOneTab = useSnapshotStore((state) => state.importOneTab);
  const deleteSnapshot = useSnapshotStore((state) => state.deleteSnapshot);
  const renameSnapshot = useSnapshotStore((state) => state.renameSnapshot);
  const restore = useSnapshotStore((state) => state.restore);
  const notify = useUndoStore((state) => state.notify);

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [view, setView] = useState<'list' | 'import' | 'report'>('list');
  const [importText, setImportText] = useState('');
  const [importName, setImportName] = useState('');

  const originBadge = (origin: string): { label: string; className: string } => {
    switch (origin) {
      case 'auto':
        return { label: t('snapshots.auto'), className: 'bg-gray-100 text-gray-500' };
      case 'archive':
        return { label: t('snapshots.archive'), className: 'bg-warn-100 text-warn-700' };
      case 'space':
        return { label: t('snapshots.space'), className: 'bg-accent-100 text-accent-700' };
      default:
        return { label: t('snapshots.manual'), className: 'bg-accent-50 text-accent-600' };
    }
  };

  const ordered = useMemo(
    () => [...snapshots].sort((a, b) => b.createdAt - a.createdAt),
    [snapshots]
  );

  const handleSave = async () => {
    try {
      await saveCurrentWindow(name.trim() || undefined);
      setName('');
      notify(t('snapshots.saved'));
    } catch {
      notify(t('errors.operationFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSpace = async () => {
    try {
      await saveSpace();
      notify(t('snapshots.saved'));
    } catch {
      notify(t('errors.operationFailed'));
    }
  };

  const handleImport = async () => {
    try {
      const count = await importOneTab(importText, importName.trim() || undefined);
      if (count === 0) {
        notify(t('snapshots.empty'));
        return;
      }
      notify(t('snapshots.imported', { count }));
      setImportText('');
      setImportName('');
      setView('list');
    } catch {
      notify(t('errors.operationFailed'));
    }
  };

  const handleRestore = async (id: string, tabCount: number) => {
    if (tabCount === 0) {
      notify(t('snapshots.empty'));
      return;
    }
    try {
      const count = await restore(id);
      notify(t('snapshots.restored', { count }));
      onClose();
    } catch {
      notify(t('errors.operationFailed'));
    }
  };

  const beginRename = (id: string, current: string) => {
    setEditingId(id);
    setEditingName(current);
  };
  const commitRename = async () => {
    try {
      if (editingId) await renameSnapshot(editingId, editingName);
    } catch {
      notify(t('errors.operationFailed'));
    } finally {
      setEditingId(null);
      setEditingName('');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSnapshot(id);
    } catch {
      notify(t('errors.operationFailed'));
    }
  };

  const weekStart = Date.now() - 7 * 24 * 3600 * 1000;
  const weekSnaps = snapshots.filter((s) => s.createdAt >= weekStart);
  const weekArchives = weekSnaps.filter((s) => s.origin === 'archive').length;
  const weekSpaces = weekSnaps.filter((s) => s.origin === 'space').length;
  const weekSnapCount = weekSnaps.length;
  const weekTabs = weekSnaps.reduce((sum, s) => sum + s.tabCount, 0);

  return (
    <DialogShell title={t('snapshots.title')} onClose={onClose} widthClassName="dialog-md">
      {view === 'import' ? (
        <div className="flex flex-col gap-2">
          <p className="text-2xs text-gray-500">{t('snapshots.importOneTabHint')}</p>
          <input
            type="text"
            className="rounded border border-gray-200 bg-surface px-2 py-1 text-xs text-gray-800  focus:border-accent-500"
            placeholder={t('snapshots.namePlaceholder')}
            aria-label={t('snapshots.namePlaceholder')}
            value={importName}
            onChange={(event) => setImportName(event.target.value)}
          />
          <textarea
            className="h-40 w-full resize-none rounded border border-gray-200 bg-surface px-2 py-1.5 text-xs text-gray-800  focus:border-accent-500"
            placeholder="https://example.com - Example"
            aria-label={t('snapshots.importOneTab')}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('list')}
            >
              {t('dialog.cancel')}
            </button>
            <button
              type="button"
              className="rounded bg-accent-600 px-2 py-1 text-2xs font-medium text-on-accent hover:bg-accent-700"
              onClick={() => void handleImport()}
            >
              {t('snapshots.importOneTab')}
            </button>
          </div>
        </div>
      ) : view === 'report' ? (
        <div className="flex flex-col gap-3">
          <p className="text-2xs text-gray-600">{t('snapshots.reportHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekSnapCount}</p>
              <p className="text-2xs text-gray-500">{t('snapshots.reportSnapshots')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekArchives}</p>
              <p className="text-2xs text-gray-500">{t('snapshots.reportArchives')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekSpaces}</p>
              <p className="text-2xs text-gray-500">{t('snapshots.space')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekTabs}</p>
              <p className="text-2xs text-gray-500">{t('snapshots.reportTabs')}</p>
            </div>
          </div>
          <button
            type="button"
            className="self-start rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
            onClick={() => setView('list')}
          >
            {t('dialog.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {!saving ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-accent-300 bg-accent-50 px-3 py-2 text-sm font-medium text-accent-700 transition-base hover:bg-accent-100"
                onClick={() => setSaving(true)}
              >
                <Icon d={Icons.snapshot} className="h-4 w-4" />
                {t('snapshots.saveCurrent')}
              </button>
              <button
                type="button"
                className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-surface px-3 py-2 text-sm font-medium text-gray-600 transition-base hover:bg-gray-50"
                onClick={() => void handleSaveSpace()}
              >
                <Icon d={Icons.folder} className="h-4 w-4" />
                {t('snapshots.space')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-surface px-2 py-1.5">
              <Icon d={Icons.snapshot} className="h-4 w-4 shrink-0 text-gray-500" />
              <input
                type="text"
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 "
                placeholder={t('snapshots.namePlaceholder')}
                aria-label={t('snapshots.namePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSave();
                  if (event.key === 'Escape') {
                    setSaving(false);
                    setName('');
                  }
                }}
              />
              <button
                type="button"
                className="rounded bg-accent-600 px-2 py-1 text-2xs font-medium text-on-accent hover:bg-accent-700"
                onClick={() => void handleSave()}
              >
                {t('snapshots.save')}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
                onClick={() => {
                  setSaving(false);
                  setName('');
                }}
              >
                {t('dialog.cancel')}
              </button>
            </div>
          )}

          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {ordered.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-500">{t('snapshots.emptyHint')}</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {ordered.map((snap) => (
                  <li key={snap.id} className="flex items-center gap-2 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      {editingId === snap.id ? (
                        <input
                          type="text"
                          className="w-full rounded border border-gray-200 bg-surface px-1.5 py-0.5 text-xs text-gray-800  focus:border-accent-500"
                          value={editingName}
                          aria-label={t('snapshots.rename')}
                          onChange={(event) => setEditingName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void commitRename();
                            if (event.key === 'Escape') {
                              setEditingId(null);
                              setEditingName('');
                            }
                          }}
                          onBlur={() => void commitRename()}
                        />
                      ) : (
                        <span className="block truncate text-xs font-medium text-gray-700">
                          {snap.name}
                        </span>
                      )}
                      <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-gray-500">
                        <span
                          className={'rounded px-1 py-px text-[10px] leading-none ' + originBadge(snap.origin).className}
                        >
                          {originBadge(snap.origin).label}
                        </span>
                        <span>
                          {snap.tabCount} {t('tabs.tabCountUnit')} · {formatTime(snap.createdAt)}
                        </span>
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={t('snapshots.restore')}
                        className="rounded p-1 text-gray-500 hover:bg-accent-50 hover:text-accent-600"
                        onClick={() => void handleRestore(snap.id, snap.tabCount)}
                      >
                        <Icon d={Icons.openAll} className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title={t('snapshots.rename')}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100"
                        onClick={() => beginRename(snap.id, snap.name)}
                      >
                        <Icon d={Icons.pencil} className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title={t('snapshots.delete')}
                        className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => void handleDelete(snap.id)}
                      >
                        <Icon d={Icons.trash} className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-2 border-t border-gray-200 pt-2">
            <button
              type="button"
              className="flex-1 rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('import')}
            >
              {t('snapshots.importOneTab')}
            </button>
            <button
              type="button"
              className="flex-1 rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('report')}
            >
              {t('snapshots.reportTitle')}
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
}
