import { dedupePins, pinFromTab, reorderPins as reorderPinsModel } from '@/core/fixed/FolderOps';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import {
  activateTab as activateTabPlatform,
  createNewTab as createNewTabPlatform,
  setPinned as setPinnedPlatform,
  queryCurrentWindowTabs,
  updateTabUrl
} from '@/platform/tabs';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import type { DataContext, DataState } from './types';

/** 固定图标切片：永久固定图标的增删、排序与打开（精确匹配优先 / 否则新建并豁免复用）。 */
export function createPinsSlice(ctx: DataContext): Partial<DataState> {
  return {
    addPin: async (tab) => {
      if (!tab.url) return;
      const pin = pinFromTab({ url: tab.url, title: tab.title || '', favIconUrl: tab.favIconUrl });
      if (!pin) return;
      await ctx.writePins((current) =>
        dedupePins([...current.filter((p) => p.identity !== pin.identity), pin])
      );
      // 同步把真实标签置为 Chrome 固定（「确保固定」语义：实时值已固定则不动，
      // 避免快照过期时翻转方向反转——快照说未固定、实际已固定会被翻成取消固定）。
      await setPinnedPlatform(tab.id, true);
      // 标签变为固定后应从临时区（站点分组）立即移入置顶区：主动刷新快照
      // 消除对 pinned 事件回灌时序的依赖。
      tabSyncService.requestRefresh();
    },

    removePin: async (pin) => {
      await ctx.writePins((current) => current.filter((p) => p.id !== pin.id));
      // 取消窗口内同身份标签的 Chrome 固定（「确保取消固定」语义，理由同 addPin）。
      const tabs = await queryCurrentWindowTabs();
      for (const tab of tabs) {
        if (tab.url && pinIdentity(tab.url) === pin.identity) {
          await setPinnedPlatform(tab.id, false);
        }
      }
      // 取消固定后标签应回到临时区（站点分组/未分组）显示：主动刷新快照，
      // 不依赖 pinned 事件回灌时序（此前表现为「切一下 tab 才出现」）。
      tabSyncService.requestRefresh();
    },

    reorderPins: async (sourceId, targetId, placeAfter) => {
      // 预算跳过无变化写（避免多余落盘与镜像调度）；updater 内以最新基线重算。
      if (reorderPinsModel(ctx.get().pins, { sourceId, targetId, placeAfter }) === ctx.get().pins) {
        return;
      }
      await ctx.writePins((current) =>
        reorderPinsModel(current, { sourceId, targetId, placeAfter })
      );
    },

    openPin: async (pin) => {
      const tabs = await queryCurrentWindowTabs();
      const windowId = tabs[0]?.windowId;
      const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
      const ranked = [...matches].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.id - b.id;
      });
      if (ranked[0]) {
        await activateTabPlatform(ranked[0].id);
        // 「确保固定」语义：实时值已固定则不动（理由同 addPin）。
        await setPinnedPlatform(ranked[0].id, true);
        return;
      }
      if (windowId === undefined) return;
      const created = await createNewTabPlatform(windowId);
      // 豁免复用：显式打开的固定图标不允许被自动合并；须在导航前发放（同 openSavedItem）。
      await grantReuseAllowance(windowId, pin.url);
      await updateTabUrl(created.id, pin.url);
      await setPinnedPlatform(created.id, true);
    }
  };
}
