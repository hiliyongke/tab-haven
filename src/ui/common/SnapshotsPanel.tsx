import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { ConfirmDialog, DialogShell } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { TextField } from '@/ui/common/TextField';
import { SnapshotRow } from '@/ui/common/SnapshotRow';

/**
 * 会话快照面板：命名快照、归档中心与 OneTab 导入。
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
  /** 当前展开查看标签清单的快照 id（再次点击收起）。 */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 待删除确认的快照 id（快照是长期资产，删除不可撤销，必须二次确认）。 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** 正在恢复的快照 id：恢复会新建大量标签（耗时数百 ms），期间禁用该行按钮防双击并发。 */
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...snapshots].sort((a, b) => b.createdAt - a.createdAt),
    [snapshots]
  );

  /**
   * 按生命周期分组展示（概念收敛）：
   * 命名快照（手动 + 轻量空间）/ 归档 / 关窗自动保存。
   *
   * 此前四种 origin 混排在一个列表里，只靠徽标区分——用户无法判断
   * 「这个对象是持续更新的、已经关闭标签的、还是系统自动兜底的」。
   * 分组后每组语义唯一，恢复预期才能对齐。
   */
  const groups = useMemo(
    () =>
      [
        {
          key: 'named' as const,
          title: t('snapshots.groupNamed'),
          desc: t('snapshots.groupNamedDesc'),
          items: ordered.filter((snap) => snap.origin === 'manual' || snap.origin === 'space')
        },
        {
          key: 'archive' as const,
          title: t('snapshots.groupArchive'),
          desc: t('snapshots.groupArchiveDesc'),
          items: ordered.filter((snap) => snap.origin === 'archive')
        },
        {
          key: 'auto' as const,
          title: t('snapshots.groupAuto'),
          desc: t('snapshots.groupAutoDesc'),
          items: ordered.filter((snap) => snap.origin === 'auto')
        }
      ].filter((group) => group.items.length > 0),
    [ordered, t]
  );

  /** 保存进行中标尺：await 期间输入框仍在，Enter 连击/双击会并发提交出重复快照。 */
  const saveInFlight = useRef(false);

  const handleSave = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      await saveCurrentWindow(name.trim() || undefined);
      setName('');
      notify(t('snapshots.saved'));
    } catch {
      notify(t('errors.operationFailed'));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const handleSaveSpace = async () => {
    try {
      await saveSpace(t('snapshots.space'));
      notify(t('snapshots.saved'));
    } catch {
      notify(t('errors.operationFailed'));
    }
  };

  const handleImport = async () => {
    try {
      const count = await importOneTab(importText, importName.trim() || undefined);
      if (count === 0) {
        // 区分「用户没粘贴内容」与「粘贴了但解析不出条目」：后者可能是因为
        // 超 1MB 被直接拒收，或整段都不是 http(s) 网址。笼统提示「快照为空」
        // 会让用户以为导入成功却得到一个空快照，无从排查。
        notify(importText.trim() ? t('snapshots.importUnparsed') : t('snapshots.empty'));
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
    // 互斥：恢复期间再点会基于同一窗口现状并发 create，可能把同一批标签开两份
    // （快照恢复没有 undo 栈式的 undoInFlight 互斥，这里在组件层补上）。
    if (restoringId !== null) return;
    setRestoringId(id);
    try {
      const count = await restore(id);
      notify(t('snapshots.restored', { count }));
      onClose();
    } catch {
      notify(t('errors.operationFailed'));
    } finally {
      setRestoringId(null);
    }
  };

  const performDelete = async (id: string) => {
    setConfirmDeleteId(null);
    try {
      await deleteSnapshot(id);
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

  const handleDelete = (id: string) => {
    // 快照（尤其归档/手动）是长期资产，单击删除不可恢复且相邻操作多、易误触。
    // 先弹确认，确认后由 performDelete 执行。
    setConfirmDeleteId(id);
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
          <TextField
            size="sm"
            placeholder={t('snapshots.namePlaceholder')}
            ariaLabel={t('snapshots.namePlaceholder')}
            value={importName}
            onChange={setImportName}
          />
          <TextField
            multiline
            className="h-40"
            placeholder={t('snapshots.importOneTabPlaceholder')}
            ariaLabel={t('snapshots.importOneTab')}
            value={importText}
            onChange={setImportText}
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
                title={t('snapshots.saveSpaceHint')}
                className="flex items-center justify-center gap-2 rounded-lg border border-control bg-surface px-3 py-2 text-sm font-medium text-gray-600 transition-base hover:bg-gray-50"
                onClick={() => void handleSaveSpace()}
              >
                <Icon d={Icons.layers} className="h-4 w-4" />
                {t('snapshots.saveSpaceAction')}
                {/* 感叹号提醒：该按钮语义不直观（每次保存都新增一条，不覆盖），悬停看完整说明 */}
                <Icon d={Icons.infoAlert} className="h-3.5 w-3.5 text-gray-400" />
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

          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
            {ordered.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-500">{t('snapshots.emptyHint')}</p>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  <h3 className="mb-1 flex items-baseline gap-1 text-2xs font-medium text-gray-500">
                    {group.title}
                    <span className="text-gray-400">
                      {t('snapshots.groupCount', { count: group.items.length })}
                    </span>
                  </h3>
                  {group.desc && (
                    <p className="mb-1 text-3xs leading-snug text-gray-500">{group.desc}</p>
                  )}
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {group.items.map((snap) => (
                      <SnapshotRow
                        key={snap.id}
                        snap={snap}
                        isEditing={editingId === snap.id}
                        editingName={editingName}
                        isDetailOpen={detailId === snap.id}
                        onEditingNameChange={setEditingName}
                        onBeginRename={beginRename}
                        onCommitRename={commitRename}
                        onCancelRename={() => {
                          setEditingId(null);
                          setEditingName('');
                        }}
                        onToggleDetail={(id) => setDetailId(detailId === id ? null : id)}
                        onRestore={handleRestore}
                        onDelete={handleDelete}
                        restoring={restoringId === snap.id}
                      />
                    ))}
                  </ul>
                </div>
              ))
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
      {confirmDeleteId !== null && (
        <ConfirmDialog
          title={t('dialog.confirmTitle')}
          message={t('snapshots.deleteConfirm')}
          danger
          confirmLabel={t('fixed.confirmDelete')}
          onConfirm={() => void performDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </DialogShell>
  );
}
