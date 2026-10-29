import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { isHttpUrl } from '@/core/url/UrlInspector';
import { queryCurrentWindowTabs } from '@/platform/tabs';
import { logDegraded } from '@/platform/diagnostics';
import { useDataStore } from '@/stores/dataStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';

/**
 * 工作区编排（C1）：把「工作区」从快照的一个 origin 升格为面板一级切换入口。
 *
 * 工作区 = 一份 origin=space 的快照。切换语义（与用户确认过的原型一致）：
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
/** 切换工作区的影响面确认阈值：将关闭的标签数达到此值才拦一道。 */
const SPACE_SWITCH_CONFIRM_THRESHOLD = 3;

/** 切换时会被关掉的标签：非固定、非隐身、且是 http(s)（与 performSwitch 同一口径）。 */
function isSwitchClosable(tab: { pinned?: boolean; incognito?: boolean; url?: string }): boolean {
  return !tab.pinned && !tab.incognito && isHttpUrl(tab.url);
}

interface PendingSwitch {
  target: Snapshot;
  /** 确认弹窗要披露的影响面：切换会关闭的标签数。 */
  closableCount: number;
}

export function useSpaces(): {
  /** 全部空间快照（按最近活跃降序）。 */
  spaces: Snapshot[];
  /** 当前激活空间 id；指向已删除快照时视为未激活（容错口径见 schema 注释）。 */
  activeSpaceId: string | undefined;
  /** 切换进行中（UI 据此禁用 chip，防连点重入）。 */
  switching: boolean;
  /** 待确认的切换：影响面达阈值时由 switchSpace 挂起，交 UI 弹确认。 */
  pendingSwitch: PendingSwitch | null;
  switchSpace: (target: Snapshot) => void;
  confirmSwitch: () => void;
  cancelSwitch: () => void;
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
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  /**
   * 待确认期间的重入守卫。
   *
   * switchSpace 里有 await（查当前窗口标签）才决定要不要弹确认，这段窗口期
   * 连点另一个 chip 会把前一个待确认目标静默覆盖。ref 与 state 由同一个
   * setter 维护，避免「state 已清空、ref 还锁着」导致切换永久不可用。
   */
  const pendingRef = useRef(false);
  const applyPending = useCallback((value: PendingSwitch | null) => {
    pendingRef.current = value !== null;
    setPendingSwitch(value);
  }, []);

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

  /**
   * 切换空间：写回现场 → 关闭当前标签 → 恢复目标 → 落盘激活 id → 提示。
   *
   * 刻意**不再**用 `void (async () => { … })()` 包一层：那样外层返回的 Promise 会在
   * 工作完成前就 resolve，调用方 `await performSwitch(...)` 拿到的「完成」是假的 ——
   * 紧接着读取状态会读到切换前的值，而 `switching` 也已被置回 false。
   */
  const performSwitch = useCallback(
    async (target: Snapshot) => {
      switchingRef.current = true;
      setSwitching(true);
      try {
        // 现场为空时不写回（保留原工作区内容），此时直接中止切换并提示。
        if (!(await flushCurrentSpace())) {
          notify(t('当前窗口没有可保存的标签，已保留原工作区内容'));
          return;
        }
        const tabs = await queryCurrentWindowTabs();
        const targetWindowId = tabs[0]?.windowId;
        const closable = tabs.filter(isSwitchClosable);
        if (closable.length > 0) {
          await useUndoStore.getState().closeWithUndo(
            closable,
            closable.map((tab) => tab.id)
          );
        }
        // 显式同一窗口：缺省会走 getLastFocused，中途焦点移动会关 A 开 B。
        const restored = await useSnapshotStore.getState().restore(target.id, targetWindowId);
        const count = restored.count;
        await useDataStore.getState().tryUpdateSettings({ activeSpaceId: target.id });
        notify(
          closable.length === 0
            ? t('已切换到「{{name}}」，恢复 {{count}} 个标签', { name: target.name, count })
            : t('已切换到「{{name}}」，恢复 {{count}} 个标签；刚才关闭的可通过撤销找回', {
                name: target.name,
                count
              })
        );
      } catch (error) {
        useUndoStore.getState().notifyFailure('spaces', t('操作失败，请稍后重试'), error);
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [flushCurrentSpace, notify, setSwitching, t]
  );

  const switchSpace = useCallback(
    (target: Snapshot) => {
      if (switchingRef.current || pendingRef.current) return;
      // 点已激活的 chip 无意义：会白跑一次「全关 + 全开」并留下一条撤销批次。
      if (target.id === useDataStore.getState().settings.activeSpaceId) return;
      // 目标空间可能已被删除：先校验，避免「关了标签却恢复 0 条」+ 激活悬空 id。
      // 文案必须说清是「目标不存在」：这里失败的是用户选中的目标，不是本次操作，
      // 报「请稍后重试」会让人反复点同一个已失效的 chip。
      if (!useSnapshotStore.getState().snapshots.some((snap) => snap.id === target.id)) {
        notifyError(t('该工作区已不存在，请刷新后重试'));
        return;
      }
      void (async () => {
        // 影响面闸门：切换会关掉当前窗口**全部**可关闭标签，是全产品影响面最大的
        // 动作之一，不能成为唯一不拦的破坏性操作（归档/恢复/删快照都有确认）。
        // 与 App.tsx 自写的「危险操作确认力度必须对称」纪律对齐。
        // 少于阈值不拦：切空间是高频动作，1-2 个标签时不该为此加摩擦。
        let closableCount: number;
        try {
          const tabs = await queryCurrentWindowTabs();
          closableCount = tabs.filter(isSwitchClosable).length;
        } catch (error) {
          // 拿不到就退回 tabStore 的窗口快照（真实计数，可能略滞后），
          // 而**不是**用阈值去冒充一次查询结果 —— 后者会让确认弹窗显示一个
          // 编造的「将关闭 N 个标签」，用户据此判断影响面，实为展示不确定态。
          // 这里的用途只是「要不要拦一道 + 显示影响面」，不涉及关闭哪些标签，
          // 因此快照口径是可接受的（关闭目标由 performSwitch 另行实时查询）。
          // 只留痕不弹 toast：影响面查询失败并不阻断切换（闸门仍会拦），
          // 弹一条「操作失败」会让用户以为切换已经失败。
          logDegraded('spaces', '切换工作区：查询影响面失败，已退回窗口快照计数', error);
          closableCount = useTabStore.getState().tabs.filter(isSwitchClosable).length;
        }
        if (closableCount >= SPACE_SWITCH_CONFIRM_THRESHOLD) {
          applyPending({ target, closableCount });
          return;
        }
        void performSwitch(target);
      })();
    },
    [applyPending, notifyError, performSwitch, t]
  );

  const confirmSwitch = useCallback(() => {
    const pending = pendingSwitch;
    applyPending(null);
    if (pending) void performSwitch(pending.target);
  }, [applyPending, pendingSwitch, performSwitch]);

  const cancelSwitch = useCallback(() => applyPending(null), [applyPending]);

  const exitSpace = useCallback(() => {
    if (switchingRef.current) return;
    if (useDataStore.getState().settings.activeSpaceId === undefined) return;
    switchingRef.current = true;
    setSwitching(true);
    void (async () => {
      try {
        if (!(await flushCurrentSpace())) {
          notify(t('当前窗口没有可保存的标签，已保留原工作区内容'));
          return;
        }
        await useDataStore.getState().tryUpdateSettings({ activeSpaceId: undefined });
        notify(t('已退出工作区，回到全部标签（原工作区已保存）'));
      } catch (error) {
        useUndoStore.getState().notifyFailure('spaces', t('操作失败，请稍后重试'), error);
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    })();
  }, [flushCurrentSpace, notify, setSwitching, t]);

  const saveAsSpace = useCallback(() => {
    // 不传名字：命名统一由 store 的 fallbackName 决定（此处传 t('工作区') 会把
    // 保存时的语言写进落盘快照名，换语言后新旧记录名称不一致）。
    void useSnapshotStore
      .getState()
      .saveSpace()
      .then((saved) => {
        // false = 现场无可保存标签（如只剩内部页）：store 已回执「没有可保存的当前标签」，
        // 此时 snapshots 列表并未新增本次空间。若照常往下走，会把「最新 space」误判成
        // 一个无关的旧工作区并激活它（activeSpaceId 悬空到别的空间），还弹出与刚才
        // 错误提示相矛盾的「已保存工作区」。必须在此中止。
        if (!saved) return;
        // 激活刚保存的空间（saveSpace 用当前时间戳，列表里最新即它）。
        const latest = useSnapshotStore
          .getState()
          .snapshots.filter((snapshot) => snapshot.origin === 'space')
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (latest) {
          void useDataStore.getState().tryUpdateSettings({ activeSpaceId: latest.id });
        }
        // 动作是「保存为工作区」，反馈却说「已保存快照」——用户会怀疑自己点错了
        // 或工作区没存上（它其实出现在顶部切换条）。反馈必须与动作同名。
        notify(t('已保存工作区'));
      })
      .catch((error: unknown) =>
        useUndoStore.getState().notifyFailure('spaces', t('操作失败，请稍后重试'), error)
      );
  }, [notify, t]);

  return {
    spaces,
    activeSpaceId,
    switching,
    pendingSwitch,
    switchSpace,
    confirmSwitch,
    cancelSwitch,
    exitSpace,
    saveAsSpace
  };
}
