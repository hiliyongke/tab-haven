import { useTranslation } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { ConfirmDialog } from '@/ui/dialog/Dialog';

/**
 * 快照恢复确认闸门（影响面摘要）。
 *
 * 恢复会一次性新建整批标签，影响面大 —— 因此任何恢复入口（快照面板与命令面板的
 * 「最近快照」）都必须先让用户看到「将打开 N 个标签（含 M 个分组）」再执行，
 * 否则同一动作在同一个产品里出现两档安全级别。
 *
 * 恢复完成后会把**本次新建的标签**记为 kind='restore' 的撤销批次，
 * 撤销该批次即关闭这批标签（见 snapshotStore.restore 与 recordRestoreForUndo）。
 * 确认闸门仍然保留：恢复是「新建」而非「关闭」，用户仍应在执行前知道会打开多少个。
 */
export function RestoreConfirmDialog({
  snapshot,
  onConfirm,
  onCancel,
  inline = false
}: {
  snapshot: Snapshot;
  /** 确认后执行（调用方负责真正恢复与结果提示）。 */
  onConfirm: () => void;
  onCancel: () => void;
  /** 调用方本身处在原生模态 dialog 内时置 true，否则弹窗点不动（见 DialogShell.inline）。 */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  // 将还原的分组数（快照内 distinct groupTitle）。
  const groupCount = new Set(snapshot.tabs.map((tab) => tab.groupTitle).filter(Boolean)).size;
  return (
    <ConfirmDialog
      title={t('恢复')}
      inline={inline}
      message={t(
        '恢复「{{name}}」将打开 {{count}} 个标签（含 {{groups}} 个标签组）。当前已打开的标签不受影响。',
        {
          name: snapshot.name,
          count: snapshot.tabCount,
          groups: groupCount
        }
      )}
      confirmLabel={t('恢复')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
