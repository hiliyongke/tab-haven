import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/common/Button';
import { TextField } from '@/ui/common/TextField';
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
        <p className="mb-3 text-sm text-gray-600">
          {t('fixed.deleteConfirm', { name: initialName })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              // 无论删除成功与否都关闭弹窗：成功时 FolderRow 卸载弹窗随之消失；
              // 失败时结果由 toast 如实告知（删除失败提示），停留在确认视图会让
              // 用户重复点击发起重复删除，且「弹窗还开着但文件夹已删」同样困惑。
              onDelete();
              onClose();
            }}
          >
            {t('dialog.confirm')}
          </Button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title={t('fixed.edit')} onClose={onClose}>
      <TextField
        className="mb-3 w-full"
        value={draft}
        placeholder={t('fixed.folderNamePlaceholder')}
        ariaLabel={t('fixed.folderNamePlaceholder')}
        onChange={(value) => setDraft(value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onRename(draft.trim() || initialName);
            onClose();
          }
        }}
      />
      <div className="flex items-center justify-between">
        <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
          {t('fixed.delete')}
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            onClick={() => {
              onRename(draft.trim() || initialName);
              onClose();
            }}
          >
            {t('dialog.save')}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
