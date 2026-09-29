import { useTranslation } from 'react-i18next';
import type { Snapshot } from '@/core/schema/models';
import { ConfirmDialog } from '@/ui/dialog/Dialog';

/**
 * 快照恢复确认闸门（影响面摘要）。
 *
 * 恢复会一次性新建整批标签，且**不在撤销栈覆盖范围内**（撤销栈只覆盖「关闭」），
 * 因此任何恢复入口——快照面板与命令面板的「最近快照」——都必须先让用户看到
 * 「将打开 N 个标签（含 M 个分组）」再执行。此前命令面板绕过该闸门，
 * 同一动作在同一个产品里出现两档安全级别。
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
