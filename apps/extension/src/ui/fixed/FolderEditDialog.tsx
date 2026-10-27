import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/ui/common/Button';
import { TextField } from '@/ui/common/TextField';
import { DialogShell } from '@/ui/dialog/Dialog';
import { FolderDeleteConfirmDialog } from '@/ui/fixed/FolderDeleteConfirmDialog';

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
    // 复用行内删除的确认口径（单一文案源），不在这里另写一份确认弹窗。
    return (
      <FolderDeleteConfirmDialog
        name={initialName}
        onConfirm={() => {
          // 无论删除成功与否都关闭弹窗：成功时 FolderRow 卸载弹窗随之消失；
          // 失败时结果由 toast 如实告知（删除失败提示），停留在确认视图会让
          // 用户重复点击发起重复删除，且「弹窗还开着但文件夹已删」同样困惑。
          onDelete();
          onClose();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  }

  return (
    <DialogShell
      title={t('编辑文件夹')}
      onClose={onClose}
      /* footer 容器是 flex justify-end gap-2，单个 w-full 子项即可铺满，
         从而实现「删除在左 / 取消+保存 在右」的底栏分区。 */
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
            {t('删除文件夹')}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('取消')}
            </Button>
            <Button
              onClick={() => {
                onRename(draft.trim() || initialName);
                onClose();
              }}
            >
              {t('保存')}
            </Button>
          </div>
        </div>
      }
    >
      <TextField
        className="w-full"
        value={draft}
        placeholder={t('文件夹名称')}
        ariaLabel={t('文件夹名称')}
        onChange={(value) => setDraft(value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onRename(draft.trim() || initialName);
            onClose();
          }
        }}
      />
    </DialogShell>
  );
}
