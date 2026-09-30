import { useTranslation } from 'react-i18next';
import type { Snapshot } from '@/core/schema/models';
import { ConfirmDialog } from '@/ui/dialog/Dialog';

/**
 * 快照恢复确认闸门（影响面摘要）。
 *
 * 恢复会一次性新建整批标签，影响面大 —— 因此任何恢复入口（快照面板与命令面板的
 * 「最近快照」）都必须先让用户看到「将打开 N 个标签（含 M 个分组）」再执行。
 * 此前命令面板绕过该闸门，同一动作在同一个产品里出现两档安全级别。
 *
 * 关于可逆性（R8 / IX-3 后已改变）：本注释曾写「恢复不在撤销栈覆盖范围内」，
 * 现已不成立 —— 恢复完成后会把**本次新建的标签**记为 kind='restore' 的撤销批次，
 * 撤销该批次即关闭这批标签（见 snapshotStore.restore 与 recordRestoreForUndo）。
 * 确认闸门仍然保留：恢复是「新建」而非「关闭」，用户仍应在执行前知道会打开多少个。
 */
export function RestoreConfirmDialog({
  snapshot,
  onConfirm,
  onCancel
}: {
  snapshot: Snapshot;
  /** 确认后执行（调用方负责真正恢复与结果提示）。 */
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // 将还原的分组数（快照内 distinct groupTitle）。
  const groupCount = new Set(snapshot.tabs.map((tab) => tab.groupTitle).filter(Boolean)).size;
  return (
    <ConfirmDialog
      title={t('snapshots.restore')}
      message={t('snapshots.restoreConfirm', {
        name: snapshot.name,
        count: snapshot.tabCount,
        groups: groupCount
      })}
      confirmLabel={t('snapshots.restore')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
