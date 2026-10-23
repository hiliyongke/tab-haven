import { useCallback, useState } from 'react';
import { DuplicateIndex } from '@/core/dup/DuplicateIndex';
import { planDuplicateCleanup, selectSleepableTabs } from '@/core/tabSelectors';
import type { Translate } from '@/i18n';
import { reloadTabs } from '@/platform/tabs';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { pulseTabRows } from '@/entrypoints/sidepanel/useLocateActive';

/**
 * 底栏/命令面板的三个批量动作：休眠全部、唤醒全部、清理重复。
 *
 * 从 `App.tsx` 拆出：这三个动作自带「在途互斥」一档状态（`batchBusy`）与各自的
 * 影响面文案，是 App 里唯一一组「状态 + 执行 + 反馈」闭环完整、可以整块搬走的
 * 逻辑。搬走后 App 只把返回的三个回调接到底栏与命令面板。
 *
 * 在途互斥用 state 而非 ref：ref 不触发重渲染，在途期间按钮既不禁用也没有进行
 * 中态，而「唤醒全部」是 reloadTabs(N 个标签)、耗时远超百毫秒级 —— 用户连点第二
 * 下完全静默，表现为「点了没反应」。在途必须可感知。
 */
export function useBatchTabActions(params: {
  t: Translate;
  /** 固定空间绑定的标签 id：休眠/清理都要豁免这批「用户显式保存的资产」。 */
  boundTabIds: readonly number[];
  discardTab: (tabId: number) => Promise<boolean>;
  closeWithUndo: ReturnType<typeof useUndoStore.getState>['closeWithUndo'];
}): {
  batchBusy: 'idle' | 'discard' | 'wake' | 'clean';
  discardInactive: () => void;
  wakeAll: () => void;
  closeDuplicates: () => void;
} {
  const { t, boundTabIds, discardTab, closeWithUndo } = params;
  const [batchBusy, setBatchBusy] = useState<'idle' | 'discard' | 'wake' | 'clean'>('idle');

  const runBatch = useCallback(
    (kind: 'discard' | 'wake' | 'clean', action: () => void | Promise<void>) => {
      if (batchBusy !== 'idle') return;
      setBatchBusy(kind);
      void Promise.resolve(action()).finally(() => {
        setBatchBusy('idle');
      });
    },
    [batchBusy]
  );

  /** 一键休眠全部后台标签、未固定的标签（释放内存）。 */
  const discardInactive = useCallback(() => {
    runBatch('discard', async () => {
      const notify = useUndoStore.getState().notify;
      const allInactive = useTabStore
        .getState()
        .tabs.filter((tab) => !tab.active && !tab.discarded);
      // 与底栏入口提示同一口径（selectSleepableTabs）：避免「提示 N 个、实际休眠 M 个」。
      const targets = selectSleepableTabs(allInactive, boundTabIds);
      // 无任何候选时必须给反馈（FooterToolbar / 命令面板按钮恒可用）：
      // 静默空跑会被当成「按钮坏了」。
      if (targets.length === 0 && allInactive.length === 0) {
        notify(t('没有可休眠的后台标签'));
        return;
      }
      const results = await Promise.all(targets.map((tab) => discardTab(tab.id)));
      const discardedCount = results.filter(Boolean).length;
      // 跳过数只统计「真正尝试过」的候选（targets 已排除绑定标签与不可安全休眠者）：
      // 用 allInactive 作基数会把固定标签也计入「跳过 N 个」，而它们本就不该参与休眠。
      const skippedCount = targets.length - discardedCount;
      if (discardedCount > 0) {
        notify(
          skippedCount === 0
            ? t('已休眠 {{count}} 个标签', { count: discardedCount })
            : t('已休眠 {{count}} 个标签，另有 {{skipped}} 个正在使用中已跳过', {
                count: discardedCount,
                skipped: skippedCount
              })
        );
      } else if (targets.length > 0) {
        notify(t('{{count}} 个标签正在使用中，已跳过', { count: targets.length }));
      } else {
        notify(t('没有可休眠的后台标签'));
      }
    });
  }, [boundTabIds, discardTab, runBatch, t]);

  /** 一键唤醒全部休眠标签（与批量休眠成对）。 */
  const wakeAll = useCallback(() => {
    runBatch('wake', () => {
      const notify = useUndoStore.getState().notify;
      const discardedIds = useTabStore
        .getState()
        .tabs.filter((tab) => tab.discarded)
        .map((tab) => tab.id);
      if (discardedIds.length === 0) {
        // 命令面板/底栏入口恒可用：无休眠标签时点按不能静默。
        notify(t('当前没有休眠中的标签'));
        return;
      }
      return reloadTabs(discardedIds).then((woken) =>
        notify(t('已唤醒 {{count}} 个标签', { count: woken.length }))
      );
    });
  }, [runBatch, t]);

  /**
   * 一键清理重复标签。
   *
   * 批量动作用「**影响面提示**」而非「强制确认弹窗」——
   * 点击即执行，不给高频用户加摩擦。影响面由两处承载：
   *   ① 执行前：底栏入口徽章/`title` 上的待清理数量（见 sleepableCount 同款口径）；
   *   ② 执行后：`closeWithUndo` 的回执（已关闭数）与保留项脉冲。
   * 清理本身进撤销栈、可一键反悔，因此不需要阻断式确认。
   */
  const closeDuplicates = useCallback(() => {
    runBatch('clean', () => {
      const notify = useUndoStore.getState().notify;
      const liveTabs = useTabStore.getState().tabs;
      const plan = planDuplicateCleanup(
        DuplicateIndex.build(liveTabs),
        useDataStore.getState().boundTabIds
      );
      if (plan.removable.length === 0) {
        // 入口条件出现（>0 才显示），但命令面板常驻：无候选时不能静默。
        notify(t('没有可清理的重复标签'));
        return;
      }
      // 保留项全程留在 DOM 里（关闭只作用于 removable），因此脉冲不需要
      // 「等 80ms 猜 DOM 已更新」这种拍脑袋的时间窗口 —— 改为等关闭动作
      // **完成后**再脉冲，用确定性信号取代猜测的延迟。
      return closeWithUndo(
        liveTabs,
        plan.removable.map((tab) => tab.id)
      ).then((result) => {
        pulseTabRows(plan.keepIds);
        return result;
      });
    });
  }, [closeWithUndo, runBatch, t]);

  return { batchBusy, discardInactive, wakeAll, closeDuplicates };
}
