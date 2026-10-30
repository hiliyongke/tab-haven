import { useCallback, useRef, useState } from 'react';
import { buildPartialSnapshot } from '@/core/snapshot/snapshotDiff';
import type { Snapshot } from '@/core/schema/models';
import type { Translate } from '@/i18n';
import { useSnapshotStore } from '@/stores/snapshotStore';

/**
 * 快照恢复的入口闸门 + 执行体 + 在途互斥。
 *
 * 从 `SnapshotsPanel` 拆出：恢复是面板里状态最多的一条链路（在途 id、整份确认 id、
 * 选择性确认的部分快照，外加 `restoreInFlight` 互斥标尺），混在主组件里时它与
 * 勾选集、删除确认、重命名编辑框挤在同一层，改一条恢复口径要在整片状态里定位。
 *
 * 两条恢复路径（整份 / 按勾选集）共用同一把在途锁：恢复是「基于窗口现状新建整批
 * 标签」，并发两次会把同一批标签开两份，而 `restore` 没有 undo 栈式的执行互斥。
 */
export function useSnapshotRestore(params: {
  t: Translate;
  snapshots: readonly Snapshot[];
  /** 勾选集键 `${index}-${url}`，与 SnapshotRow 行键一致。 */
  selectedKeys: ReadonlySet<string>;
  notify: (message: string) => void;
  notifyFailure: (scope: string, message: string, error: unknown) => void;
  /** 恢复成功后关闭面板。 */
  onClose: () => void;
}): {
  /** 正在恢复的快照 id：期间禁用该行按钮防双击并发。 */
  restoringId: string | null;
  /** 待确认的整份恢复 id。 */
  confirmRestoreId: string | null;
  setConfirmRestoreId: (id: string | null) => void;
  /** 待确认的选择性恢复（勾选集已固化为部分快照）。 */
  confirmRestoreSelected: Snapshot | null;
  setConfirmRestoreSelected: (snapshot: Snapshot | null) => void;
  requestRestore: (id: string, tabCount: number) => void;
  runRestore: (id: string) => Promise<void>;
  requestRestoreSelected: (id: string, tabCount: number) => void;
  runRestoreSelected: (partial: Snapshot) => Promise<void>;
} {
  const { t, snapshots, selectedKeys, notify, notifyFailure, onClose } = params;
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [confirmRestoreSelected, setConfirmRestoreSelected] = useState<Snapshot | null>(null);
  /** 在途标尺用 ref：渲染期 state 在同一帧内读不到刚置的值，拦不住连点。 */
  const restoreInFlight = useRef(false);

  /** 入口：空快照直接提示，否则弹影响面确认（N 标签 + M 组）。 */
  const requestRestore = useCallback(
    (id: string, tabCount: number) => {
      if (tabCount === 0) {
        notify(t('该快照没有可恢复的标签'));
        return;
      }
      setConfirmRestoreId(id);
    },
    [notify, t]
  );

  /** 整份恢复执行体。入口已拦截空快照，此处不再重复判空。 */
  const runRestore = useCallback(
    async (id: string) => {
      if (restoreInFlight.current) return;
      restoreInFlight.current = true;
      setRestoringId(id);
      try {
        const { restore } = useSnapshotStore.getState();
        const { count, degraded } = await restore(id);
        notify(
          degraded
            ? t('已恢复 {{count}} 个标签；部分恢复结果可能不完整，请检查标签列表', {
                count
              })
            : t('已恢复 {{count}} 个标签', { count })
        );
        onClose();
      } catch (error) {
        // 走 notifyFailure：保存/导入/恢复/删除/重命名都是写路径，失败必须进诊断
        // 导出，否则「点了没反应」在用户与开发者两侧都无从定位。
        notifyFailure('snapshots', t('操作失败，请稍后重试'), error);
      } finally {
        restoreInFlight.current = false;
        setRestoringId(null);
      }
    },
    [notify, notifyFailure, onClose, t]
  );

  /** 按当前勾选集恢复，同样先弹影响面确认（与整份恢复同一闸门）。 */
  const requestRestoreSelected = useCallback(
    (id: string, tabCount: number) => {
      if (tabCount === 0) {
        notify(t('请先勾选要恢复的条目'));
        return;
      }
      const snap = snapshots.find((entry) => entry.id === id);
      if (!snap) return;
      const selectedTabs = snap.tabs.filter((tab, index) =>
        selectedKeys.has(`${index}-${tab.url}`)
      );
      if (selectedTabs.length === 0) {
        notify(t('请先勾选要恢复的条目'));
        return;
      }
      setConfirmRestoreSelected(buildPartialSnapshot(snap, selectedTabs));
    },
    [notify, selectedKeys, snapshots, t]
  );

  /** 确认后的选择性恢复执行体（勾选集已固化为传入的部分快照）。 */
  const runRestoreSelected = useCallback(
    async (partial: Snapshot) => {
      setConfirmRestoreSelected(null);
      if (restoreInFlight.current) return;
      restoreInFlight.current = true;
      setRestoringId(partial.id);
      try {
        const { restoreSelected } = useSnapshotStore.getState();
        const { count, degraded } = await restoreSelected(partial.id, partial.tabs);
        notify(
          degraded
            ? t('已恢复 {{count}} 个标签；部分恢复结果可能不完整，请检查标签列表', {
                count
              })
            : t('已恢复 {{count}} 个标签', { count })
        );
        onClose();
      } catch (error) {
        notifyFailure('snapshots', t('操作失败，请稍后重试'), error);
      } finally {
        restoreInFlight.current = false;
        setRestoringId(null);
      }
    },
    [notify, notifyFailure, onClose, t]
  );

  return {
    restoringId,
    confirmRestoreId,
    setConfirmRestoreId,
    confirmRestoreSelected,
    setConfirmRestoreSelected,
    requestRestore,
    runRestore,
    requestRestoreSelected,
    runRestoreSelected
  };
}
