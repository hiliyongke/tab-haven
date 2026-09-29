import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Snapshot } from '@/core/schema/models';
import { queryCurrentWindowTabs } from '@/platform/tabs';
import { useDataStore } from '@/stores/dataStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 工作空间编排（C1）：把「空间」从快照的一个 origin 升格为面板一级切换入口。
 *
 * 空间 = 一份 origin=space 的快照。切换语义（与用户确认过的原型一致）：
 *  1. 当前激活空间存在 → 把当前窗口现场**原地写回**该空间（不新增快照条目）；
 *  2. 关闭当前窗口的非固定、非隐身标签（走撤销批次，误切可一键找回）；
 *  3. 恢复目标空间的标签到**同一个窗口**（显式 windowId，避免焦点漂移错窗口）；
 *  4. 记住激活态（settings.activeSpaceId）。
 *
 * 编排放入口层 hook 而非 store：需要同时驱动 snapshotStore（存/恢复）、
 * undoStore（可撤销关闭）与 dataStore（设置），避免 store 相互依赖。
 *
 * 值一律经 `getState()` 读取而非渲染态快照：编排内有多段 await，
 * 渲染态的 `activeSpaceId` 会停留在点击那一刻的旧值。
 */
export function useSpaces(): {
  /** 全部空间快照（按最近活跃降序）。 */
  spaces: Snapshot[];
  /** 当前激活空间 id；指向已删除快照时视为未激活（容错口径见 schema 注释）。 */
  activeSpaceId: string | undefined;
  /** 切换进行中（UI 据此禁用 chip，防连点重入）。 */
  switching: boolean;
  switchSpace: (target: Snapshot) => void;
  /** 退出空间回到「全部标签」态（先把现场写回原空间）。 */
  exitSpace: () => void;
  saveAsSpace: () => void;
} {
  const { t } = useTranslation();
  const snapshots = useSnapshotStore((state) => state.snapshots);
  const activeSpaceId = useDataStore((state) => state.settings.activeSpaceId);
  const notify = useUndoStore((state) => state.notify);
  const notifyError = useUndoStore((state) => state.notifyError);
  /** 重入守卫：切换含 3 段 await（数百 ms），连点会并发存回/关闭/恢复。 */
  const switchingRef = useRef(false);
  const [switching, setSwitching] = useState(false);

  const spaces = useMemo(
    () =>
      snapshots
        .filter((snapshot) => snapshot.origin === 'space')
        .sort((a, b) => b.createdAt - a.createdAt),
    [snapshots]
  );

  /** 把现场写回当前激活空间（无激活空间 = 「全部标签」态，无需写回）。 */
  const flushCurrentSpace = useCallback(async (): Promise<boolean> => {
    const current = useDataStore.getState().settings.activeSpaceId;
    if (current === undefined) return true;
    return useSnapshotStore.getState().updateSpace(current);
  }, []);

  const switchSpace = useCallback(
    (target: Snapshot) => {
      if (switchingRef.current) return;
      // 点已激活的 chip 无意义：会白跑一次「全关 + 全开」并留下一条撤销批次。
      if (target.id === useDataStore.getState().settings.activeSpaceId) return;
      // 目标空间可能已被删除：先校验，避免「关了标签却恢复 0 条」+ 激活悬空 id。
      if (!useSnapshotStore.getState().snapshots.some((snap) => snap.id === target.id)) {
        notifyError(t('errors.operationFailed'));
        return;
      }
      switchingRef.current = true;
      setSwitching(true);
      void (async () => {
        try {
          // 现场为空时不写回（保留原空间内容），此时直接中止切换并提示。
          if (!(await flushCurrentSpace())) {
            notify(t('spaces.emptyScene'));
            return;
          }
          const tabs = await queryCurrentWindowTabs();
          const targetWindowId = tabs[0]?.windowId;
          const closable = tabs.filter(
            (tab) => !tab.pinned && !tab.incognito && /^https?:\/\//i.test(tab.url ?? '')
          );
          if (closable.length > 0) {
            await useUndoStore.getState().closeWithUndo(
              closable,
              closable.map((tab) => tab.id)
            );
          }
          // 显式同一窗口：缺省会走 getLastFocused，中途焦点移动会关 A 开 B。
          const count = await useSnapshotStore.getState().restore(target.id, targetWindowId);
          await useDataStore.getState().tryUpdateSettings({ activeSpaceId: target.id });
          notify(
            closable.length === 0
              ? t('spaces.switchedNoClose', { name: target.name, count })
              : t('spaces.switched', { name: target.name, count })
          );
        } catch {
          notifyError(t('errors.operationFailed'));
        } finally {
          switchingRef.current = false;
          setSwitching(false);
        }
      })();
    },
    [flushCurrentSpace, notify, notifyError, setSwitching, t]
  );

  const exitSpace = useCallback(() => {
    if (switchingRef.current) return;
    if (useDataStore.getState().settings.activeSpaceId === undefined) return;
    switchingRef.current = true;
    setSwitching(true);
    void (async () => {
      try {
        if (!(await flushCurrentSpace())) {
          notify(t('spaces.emptyScene'));
          return;
        }
        await useDataStore.getState().tryUpdateSettings({ activeSpaceId: undefined });
        notify(t('spaces.exited'));
      } catch {
        notifyError(t('errors.operationFailed'));
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    })();
  }, [flushCurrentSpace, notify, notifyError, setSwitching, t]);

  const saveAsSpace = useCallback(() => {
    void useSnapshotStore
      .getState()
      .saveSpace(t('snapshots.space'))
      .then(() => {
        // 激活刚保存的空间（saveSpace 用当前时间戳，列表里最新即它）。
        const latest = useSnapshotStore
          .getState()
          .snapshots.filter((snapshot) => snapshot.origin === 'space')
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (latest) {
          void useDataStore.getState().tryUpdateSettings({ activeSpaceId: latest.id });
        }
        notify(t('snapshots.saved'));
      })
      .catch(() => notifyError(t('errors.operationFailed')));
  }, [notify, notifyError, t]);

  return { spaces, activeSpaceId, switching, switchSpace, exitSpace, saveAsSpace };
}
