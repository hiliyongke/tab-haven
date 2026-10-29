import { browser } from 'wxt/browser';
import { planRegroup } from '@/core/group/AutoGrouping';
import { mapTab } from '@/platform/tabs';
import { readSession } from '@/platform/storage/session';
import { foldersRepository, settingsRepository } from '@/platform/storage/repositories';
import { regroupTempArea } from '@/platform/group/AutoGroupSync';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 工具栏图标「点击即整理」：后台完成一次与面板「快速整理」同语义的重组，
 * 打散临时区现有原生组后按当前聚合方式重新建组；固定区域不参与。
 */

/** 固定空间排除集（绑定标签 + 挂起标签），与面板侧 fixedExcludedTabIds 同口径。 */
export async function readFixedExcludedTabIds(): Promise<Set<number>> {
  const [folders, session] = await Promise.all([foldersRepository.read(), readSession()]);
  const excluded = new Set<number>(Object.values(session.itemTabBindings));
  for (const folder of folders) {
    for (const item of folder.items) {
      if (item.pendingTabId !== undefined) excluded.add(item.pendingTabId);
    }
  }
  return excluded;
}

/** 执行一轮后台整理，返回成功创建的组数（无可整理内容返回 0）；行为与面板按钮一致。 */
export async function runActionClickRegroup(): Promise<number> {
  try {
    const [rawTabs, settings, excludedTabIds] = await Promise.all([
      browser.tabs.query({ currentWindow: true }),
      settingsRepository.read(),
      readFixedExcludedTabIds()
    ]);
    const plan = planRegroup({
      tabs: rawTabs.map(mapTab),
      excludedTabIds,
      groupMode: settings.groupMode,
      threshold: settings.aggregationThreshold
    });
    if (plan.ungroupTabIds.length === 0 && plan.plans.length === 0) return 0;
    return await regroupTempArea(plan.ungroupTabIds, plan.plans);
  } catch (error) {
    logDegraded('action-regroup', '工具栏一键整理失败', error);
    return 0;
  }
}
