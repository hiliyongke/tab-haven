import { useTranslation } from '@/i18n';
import { ConfirmDialog } from '@/ui/dialog/Dialog';

/**
 * 删除文件夹的二次确认：**单一口径**。
 *
 * 同一动作此前有两条路径两套文案 —— 行内「删除文件夹（标签保留）」走
 * ConfirmDialog（按钮「确认删除」、带句号），编辑弹窗内手写确认（按钮「删除」、
 * 用直角引号、无句号）。两处各写一份时，改文案必漏一处，用户在不同入口看到
 * 同一个动作的两种说法。
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
