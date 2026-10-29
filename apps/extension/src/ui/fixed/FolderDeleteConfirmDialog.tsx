import { useTranslation } from '@/i18n';
import { ConfirmDialog } from '@/ui/dialog/Dialog';

/**
 * 删除文件夹的二次确认：**单一口径**。
 *
 * 危险操作的确认按钮用**动作本身**（「确认删除」）而非中性的「确定」：
 * 让用户点下的那一刻就知道自己要做什么（见 Dialog.tsx 的 confirmLabel 约定）。
 */
export function FolderDeleteConfirmDialog({
  name,
  onConfirm,
  onCancel
}: {
  /** 文件夹名（原文进入提示文案）。 */
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      title={t('删除文件夹')}
      message={t('删除文件夹“{{name}}”？正在打开的标签不会关闭。', { name })}
      danger
      confirmLabel={t('确认删除')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
