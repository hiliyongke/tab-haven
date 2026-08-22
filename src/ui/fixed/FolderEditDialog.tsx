import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/ui/dialog/Dialog';

/**
 * 固定文件夹编辑弹窗：改名 + 删除（结构与原生组 GroupEditDialog 一致，
 * 只是不涉及 chrome 原生组 color）。
 */
export function FolderEditDialog({
  initialName,
  onRename,
  onDelete,
  onClose
}: {
  initialName: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialName);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (confirmDelete) {
    return (
      <DialogShell title={t('fixed.delete')} onClose={() => setConfirmDelete(false)}>
        <p className="mb-3 text-sm text-gray-600">{t('fixed.deleteConfirm', { name: initialName })}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
            onClick={() => setConfirmDelete(false)}
          >
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-red-600 px-3 py-1 text-sm text-on-accent hover:opacity-90"
            onClick={onDelete}
          >
            {t('dialog.confirm')}
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title={t('fixed.edit')} onClose={onClose}>
      <input
        className="mb-3 w-full rounded border border-gray-300 bg-surface px-2 py-1.5 text-sm text-gray-800 outline-none focus:border-accent-500"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onRename(draft.trim() || initialName);
            onClose();
          }
        }}
        placeholder={t('fixed.folderNamePlaceholder')}
      />
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50"
          onClick={() => setConfirmDelete(true)}
        >
          {t('fixed.delete')}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
            onClick={onClose}
          >
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-accent-600 px-3 py-1 text-sm text-on-accent hover:bg-accent-700"
            onClick={() => {
              onRename(draft.trim() || initialName);
              onClose();
            }}
          >
            {t('dialog.save')}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}