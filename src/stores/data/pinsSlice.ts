import { dedupePins, pinFromTab, reorderPins as reorderPinsModel } from '@/core/fixed/FolderOps';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import {
  activateTab as activateTabPlatform,
  createNewTab as createNewTabPlatform,
  togglePinned as togglePinnedPlatform,
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
      const next = dedupePins([...ctx.get().pins.filter((p) => p.identity !== pin.identity), pin]);
      await ctx.writePins(next);
      // 同步把真实标签置为 Chrome 固定。
      // togglePinned 为翻转语义：传入「当前未固定 false」→ 翻转为固定。
      if (!tab.pinned) await togglePinnedPlatform(tab.id, false);
      // 标签变为固定后应从临时区（站点分组）立即移入置顶区：主动刷新快照
      // 消除对 pinned 事件回灌时序的依赖。
      tabSyncService.requestRefresh();
    },

    removePin: async (pin) => {
      await ctx.writePins(ctx.get().pins.filter((p) => p.id !== pin.id));
      // 取消窗口内同身份标签的 Chrome 固定
      const tabs = await queryCurrentWindowTabs();
      for (const tab of tabs) {
        if (tab.pinned && tab.url && pinIdentity(tab.url) === pin.identity) {
          // togglePinned 为翻转语义：传入「当前已固定 true」→ 翻转为取消固定。
          await togglePinnedPlatform(tab.id, true);
        }
      }
      // 取消固定后标签应回到临时区（站点分组/未分组）显示：主动刷新快照，
      // 不依赖 pinned 事件回灌时序（此前表现为「切一下 tab 才出现」）。
      tabSyncService.requestRefresh();
    },

    reorderPins: async (sourceId, targetId, placeAfter) => {
      const next = reorderPinsModel(ctx.get().pins, { sourceId, targetId, placeAfter });
      if (next === ctx.get().pins) return;
      await ctx.writePins(next);
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
        // togglePinned 为翻转语义：传入「当前未固定 false」→ 翻转为固定。
        if (!ranked[0].pinned) await togglePinnedPlatform(ranked[0].id, false);
        return;
      }
      if (windowId === undefined) return;
      const created = await createNewTabPlatform(windowId);
      // 豁免复用：显式打开的固定图标不允许被自动合并；须在导航前发放（同 openSavedItem）。
      await grantReuseAllowance(windowId, pin.url);
      await updateTabUrl(created.id, pin.url);
      // togglePinned 为翻转语义：传入「当前未固定 false」→ 翻转为固定。
      await togglePinnedPlatform(created.id, false);
    }
  };
}
