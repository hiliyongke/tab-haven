import { useTranslation } from '@/i18n';
import type { FixedFolder } from '@/core/schema/models';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { FolderDeleteConfirmDialog } from '@/ui/fixed/FolderDeleteConfirmDialog';
import { FolderEditDialog } from '@/ui/fixed/FolderEditDialog';

export type FolderDialog = { type: 'edit' } | { type: 'convert' } | { type: 'delete' } | null;

/**
 * 固定文件夹的三个弹窗（改名 / 转原生组 / 删除确认）。
 *
 * 从 `FolderRow` 拆出的原因：它们只负责「问一句 + 回调」，写盘与通知留在行组件；
 * 三者的 JSX 占原文件近 50 行，且与行的折叠/拖拽/菜单逻辑毫无复用关系。
 *
 * 必须**脱离 GroupCard 的折叠闸门**渲染：GroupCard 对 children 用了
 * `{!collapsed && children}`，折叠态下弹窗不会被挂载，导致点编辑/删除无反应。
 */
export function FolderRowDialogs({
  dialog,
  folder,
  onClose,
  onRename,
  onDelete,
  onConvert
}: {
  dialog: FolderDialog;
  folder: FixedFolder;
  onClose: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onConvert: () => void;
}) {
  const { t } = useTranslation();
  if (dialog === null) return null;
  if (dialog.type === 'edit') {
    return (
      <FolderEditDialog
        initialName={folder.name}
        onRename={onRename}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
  }
  if (dialog.type === 'convert') {
    return (
      <ConfirmDialog
        title={t('恢复为原生标签组')}
        message={t('将打开「{{name}}」中的标签，并删除这个文件夹。是否继续？', {
          name: folder.name
        })}
        danger
        onConfirm={() => {
          onClose();
          onConvert();
        }}
        onCancel={onClose}
      />
    );
  }
  return (
    <FolderDeleteConfirmDialog
      name={folder.name}
      onConfirm={() => {
        onClose();
        onDelete();
      }}
      onCancel={onClose}
    />
  );
}
