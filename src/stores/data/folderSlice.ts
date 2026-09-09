import { createFolder as createFolderModel, createFolderItem } from '@/core/fixed/FolderOps';
import type { FixedFolder } from '@/core/schema/models';
import {
  computeAddTabsToFolder,
  computeMoveFolder,
  computeMoveFolderItem,
  computeRemoveFolder,
  computeReorderFolderItems,
  computeRenameFolder,
  computeToggleFolderCollapsed,
  fixedItemKey
} from '@/core/commands/folderCommands';
import { reconcileBindings, reconcilePendingItems } from '@/core/fixed/Reconcile';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { structuralSignature } from '@/core/util/signature';
import { logDegraded } from '@/platform/diagnostics';
import { mutateSession, readSession } from '@/platform/storage/session';
import {
  activateTab as activateTabPlatform,
  createNewTab as createNewTabPlatform,
  groupTabs,
  queryCurrentWindowTabs,
  updateGroupMeta,
  updateTabUrl,
  waitForTabGroupAssignment
} from '@/platform/tabs';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import { BINDINGS_SCOPE } from './context';
import type { AddTabsToFolderResult, DataContext, DataState } from './types';

/**
 * 文件夹切片：收藏夹的增删改/拖入/排序、固定条目打开与跨组移动、原生组 ↔ 固定文件夹转换、
 * 以及每次标签事件后的挂起转正 + 绑定维护。
 */
export function createFolderSlice(ctx: DataContext): Partial<DataState> {
  return {
    createFolder: async (name) => {
      const folder = createFolderModel(name);
      await ctx.writeFolders((current) => [...current, folder]);
      return folder;
    },

    renameFolder: async (folderId, name) => {
      await ctx.writeFolders((current) => computeRenameFolder(current, folderId, name));
    },

    deleteFolder: async (folderId) => {
      const result = await mutateSession((session) => {
        const bindings = { ...session.itemTabBindings };
        for (const item of ctx.get().folders.find((f) => f.id === folderId)?.items ?? []) {
          delete bindings[item.id];
        }
        return { itemTabBindings: bindings };
      });
      await ctx.writeFolders((current) => computeRemoveFolder(current, folderId));
      ctx.applyBindings(result);
      // 删除文件夹后其打开标签的绑定被释放：主动刷新快照让它们立即回到临时区
      // （站点分组/未分组），避免依赖下一次标签事件。
      tabSyncService.requestRefresh();
    },

    toggleFolderCollapsed: async (folderId) => {
      await ctx.writeFolders((current) => computeToggleFolderCollapsed(current, folderId));
    },

    addTabsToFolder: async (tabs, folderId) => {
      // 导入事务进行中：写 folders 会被丢弃，而下面的 mutateSession 却会照常执行 ——
      // 结果是指向不存在条目的脏绑定。直接跳过整条路径，避免「提示成功但没变化」。
      if (ctx.isImporting()) {
        logDegraded('dataStore', '导入事务进行中，本次拖入固定空间已跳过');
        return { added: 0, moved: 0, skipped: tabs.length } satisfies AddTabsToFolderResult;
      }
      const candidates = new Map<string, { url: string; title: string; favIconUrl?: string }>();
      for (const tab of tabs) {
        const key = webComparisonKey(tab.url, tab.pendingUrl);
        if (!key) continue;
        candidates.set(key, {
          url: key,
          title: tab.title || key,
          favIconUrl: tab.favIconUrl
        });
      }
      if (candidates.size === 0) {
        return { added: 0, moved: 0, skipped: tabs.length };
      }

      // 纯计算推迟到写入前一刻，以最新基线重算（updater 内 get→算→set 无间隙）。
      // 旧顺序（入口取基线 → await mutateSession → 旧基线整表回写）在并发间隙会
      // 覆盖期间发生的其他 folders 变更（重命名被回滚、另一次拖入丢失）。
      // 绑定建边顺序随之调整为「先写 folders、后建绑定」：绑定引用已写入的条目 id，
      // 两分区无法真原子，残留窗口由 reconcileWithTabs 最终一致兜底。
      let computed: ReturnType<typeof computeAddTabsToFolder> | null = null;
      let baseline: FixedFolder[] = [];
      await ctx.writeFolders((current) => {
        // 目标文件夹在并发间隙被删除时整单放弃：core 纯函数对不存在的 folderId
        // 会把条目静默丢弃（先移除后无处追加），切片层必须兜底。
        if (!current.some((folder) => folder.id === folderId)) return current;
        computed = computeAddTabsToFolder(current, candidates, folderId);
        baseline = current;
        return computed.next;
      });
      if (computed === null) {
        return { added: 0, moved: 0, skipped: tabs.length } satisfies AddTabsToFolderResult;
      }
      // updater 已执行完毕，此处收窄为非空（闭包赋值不被控制流追踪）。
      const settled: ReturnType<typeof computeAddTabsToFolder> = computed;

      const result = await mutateSession((session) => {
        const bindings = { ...session.itemTabBindings };
        const boundTabIds = new Set(Object.values(bindings));
        for (const folder of baseline) {
          for (const item of folder.items) {
            const key = fixedItemKey(item.url);
            // 无 URL 条目判不出身份，不参与「被候选覆盖」的解绑判定。
            if (key === null) continue;
            const selected = settled.selectedExisting.get(key);
            if (
              settled.duplicateItemIds.has(item.id) ||
              (settled.comparisonKeys.has(key) && selected?.id !== item.id)
            ) {
              const boundId = bindings[item.id];
              delete bindings[item.id];
              if (boundId !== undefined) boundTabIds.delete(boundId);
            }
          }
        }
        // 为新条目建立绑定：按 URL 匹配传入标签，未占用、未固定、非隐身的才绑定，
        // 让刚拖入的标签立即从临时区排除（否则要等 reconcileWithTabs 才补绑）。
        for (const newItem of settled.newItems) {
          const key = fixedItemKey(newItem.url);
          if (key === null) continue;
          const tab = tabs.find((candidate) => {
            return (
              webComparisonKey(candidate.url, candidate.pendingUrl) === key &&
              !candidate.pinned &&
              !candidate.incognito &&
              !boundTabIds.has(candidate.id)
            );
          });
          if (tab) {
            bindings[newItem.id] = tab.id;
            boundTabIds.add(tab.id);
          }
        }
        return { itemTabBindings: bindings };
      });
      ctx.applyBindings(result);
      return {
        added: settled.newItems.length,
        moved: settled.moved,
        skipped: tabs.length - candidates.size + settled.targetDuplicates
      } satisfies AddTabsToFolderResult;
    },

    removeFolderItem: async (folderId, itemId) => {
      const result = await mutateSession((session) => {
        const bindings = { ...session.itemTabBindings };
        delete bindings[itemId];
        return { itemTabBindings: bindings };
      });
      // 同步绑定标签 id，让被释放的标签立即回到临时区。
      ctx.applyBindings(result);

      await ctx.writeFolders((current) =>
        current.map((folder) =>
          folder.id === folderId
            ? { ...folder, items: folder.items.filter((item) => item.id !== itemId) }
            : folder
        )
      );
      // 主动刷新快照：被释放的标签可能带原生组/固定等浏览器侧状态，UI 分组要按
      // 其最新 groupId/pinned 立刻归类（站点分组等），不能等下一次事件驱动刷新。
      tabSyncService.requestRefresh();
    },

    reorderFolderItems: async ({ folderId, sourceId, targetId, placeAfter }) => {
      await ctx.writeFolders((current) =>
        computeReorderFolderItems(current, { folderId, sourceId, targetId, placeAfter })
      );
    },

    moveFolder: async (sourceId, targetId, placeAfter) => {
      await ctx.writeFolders((current) =>
        computeMoveFolder(current, { sourceId, targetId, placeAfter })
      );
    },

    moveFolderItem: async (sourceFolderId, itemId, targetFolderId) => {
      await ctx.writeFolders((current) =>
        computeMoveFolderItem(current, { sourceFolderId, itemId, targetFolderId })
      );
    },

    openSavedItem: async (item) => {
      const tabs = await queryCurrentWindowTabs();
      const { itemTabBindings: bindings } = await readSession();
      const windowId = tabs[0]?.windowId;

      // 0) 挂起条目优先：激活其待导航标签（url 尚未转正时避免误匹配/重复新建）
      if (item.pendingTabId !== undefined) {
        const pendingTab = tabs.find((tab) => tab.id === item.pendingTabId);
        if (pendingTab) {
          await activateTabPlatform(pendingTab.id);
          return;
        }
      }

      // 1) 绑定标签优先
      const boundTabId = bindings[item.id];
      if (boundTabId !== undefined && tabs.some((tab) => tab.id === boundTabId)) {
        await activateTabPlatform(boundTabId);
        return;
      }
      // 2) 窗口内精确 URL 匹配（与 UI 侧判定同一口径，见 core/fixed/ItemMatch）
      const exact = tabs.find((tab) => itemUrlMatchesTab(item.url, tab) && !tab.incognito);
      if (exact) {
        const result = await mutateSession((session) => ({
          itemTabBindings: { ...session.itemTabBindings, [item.id]: exact.id }
        }));
        ctx.applyBindings(result);
        await activateTabPlatform(exact.id);
        return;
      }
      // 3) 新建并绑定
      if (windowId === undefined) return;
      const created = await createNewTabPlatform(windowId);
      // 豁免复用：显式打开的固定项不允许被自动合并（与 RestoreEngine 一致）。
      // 须在导航前发放（onUpdated 先到时令牌未就位会被合并），创建失败则不发放（避免令牌残留误豁免）。
      if (item.url) {
        await grantReuseAllowance(windowId, item.url);
        await updateTabUrl(created.id, item.url);
      }
      const result = await mutateSession((session) => ({
        itemTabBindings: { ...session.itemTabBindings, [item.id]: created.id }
      }));
      ctx.applyBindings(result);
    },

    createFolderFromNativeGroup: async (name, groupTabs) => {
      // 导入事务进行中：写 folders 会被丢弃，而绑定变更会照常发生 —— 同 addTabsToFolder，
      // 会留下指向不存在条目的脏绑定。整条路径跳过。
      if (ctx.isImporting()) {
        logDegraded('dataStore', '导入事务进行中，本次「保存为固定文件夹」已跳过');
        return false;
      }
      const savable = new Map<string, { url: string; title: string; favIconUrl?: string }>();
      for (const tab of groupTabs) {
        const key = webComparisonKey(tab.url, tab.pendingUrl);
        if (key) {
          savable.set(key, {
            url: key,
            title: tab.title || key,
            favIconUrl: tab.favIconUrl
          });
        }
      }
      const items = [...savable.values()].map((entry) => createFolderItem(entry));
      // 组内全部是不可收藏的内部页（chrome:// 等）时，不建「空文件夹」并向调用方
      // 说明 —— 否则固定空间凭空多一个空夹、界面还提示「已保存」，看似丢数据。
      if (items.length === 0) return false;
      const folder = createFolderModel(name);
      await ctx.writeFolders((current) => [...current, { ...folder, items }]);

      // 建立绑定：精确 URL 匹配（串行化内完成，防并发覆盖）
      const result = await mutateSession((session) => {
        const bindings = { ...session.itemTabBindings };
        const boundTabIds = new Set(Object.values(bindings));
        for (const item of items) {
          const match = groupTabs.find(
            (tab) =>
              webComparisonKey(tab.url, tab.pendingUrl) === item.url &&
              !tab.pinned &&
              !boundTabIds.has(tab.id)
          );
          if (match) {
            bindings[item.id] = match.id;
            boundTabIds.add(match.id);
          }
        }
        return { itemTabBindings: bindings };
      });
      ctx.applyBindings(result);
      return true;
    },

    syncFolderToNativeGroup: async (folderId) => {
      const folder = ctx.get().folders.find((f) => f.id === folderId);
      if (!folder) return false;

      const items = folder.items.filter((item) => item.url);
      if (items.length === 0) return false;

      // 先恢复已关闭的固定条目，确保转换不是“只处理当前碰巧打开的标签”。
      // 窗口内标签集合在一次查询内复用（openSavedItem 新建的标签由末尾补查感知）。
      const initialTabs = await queryCurrentWindowTabs();
      for (const item of items) {
        const alreadyOpen = initialTabs.some(
          (tab) => itemUrlMatchesTab(item.url, tab) && !tab.incognito && !tab.pinned
        );
        if (!alreadyOpen) await ctx.get().openSavedItem(item);
      }

      const tabs = await queryCurrentWindowTabs();
      const memberIds: number[] = [];
      const seen = new Set<number>();
      for (const item of items) {
        const tab = tabs.find(
          (candidate) =>
            itemUrlMatchesTab(item.url, candidate) &&
            !candidate.incognito &&
            !candidate.pinned &&
            !seen.has(candidate.id)
        );
        if (tab) {
          memberIds.push(tab.id);
          seen.add(tab.id);
        }
      }
      if (memberIds.length === 0) return false;

      const groupId = await groupTabs(memberIds);
      if (groupId === undefined) return false;
      await updateGroupMeta(groupId, folder.name);
      // 确定性收敛：等待 Chrome 把成员 tab 的 groupId 真正置为新组（tabs.group()
      // resolve 后存在可见性收敛窗口，此前表现为「转完不显示，切换一下 tab 才
      // 出现」）。收敛完成后再删夹、再刷新，UI 拿到的快照即最终状态。
      await waitForTabGroupAssignment(memberIds, groupId);
      await ctx.get().deleteFolder(folderId);
      // 主动请求快照刷新：把最终状态呈现为新原生组/归并到对应分区。requestRefresh
      // 与事件驱动共用 signal 的合并机制，二者同时发生时不会重复查询。
      tabSyncService.requestRefresh();
      return true;
    },

    reconcileWithTabs: async (tabs) => {
      // 初始化完成前 folders 为初始空值，不是真实状态：若此时执行绑定协调，
      // reconcileBindings 会把磁盘上全部 item↔tab 绑定判定为「条目已不存在」
      // 并整表写空（sidepanel/popup 每次挂载的首帧都会触发，属确定性数据丢失）。
      // ready 后才允许协调；同时保证 ready 切换后至少重跑一次见入口层依赖。
      if (!ctx.get().ready) return;
      // 挂起条目转正
      const pending = reconcilePendingItems(ctx.get().folders, tabs);
      if (pending.changed) {
        await ctx.writeFolders(pending.folders);
      }

      // 绑定维护（串行化内 read-modify-write，防与用户操作竞态）
      const result = await mutateSession((session) => {
        const bindingResult = reconcileBindings(pending.folders, tabs, session.itemTabBindings);
        if (!bindingResult.changed) return {};
        return { itemTabBindings: bindingResult.bindings };
      });
      const nextBoundTabIds = Object.values(result.data.itemTabBindings);
      // 仅当绑定集合实际变化时才更新 store，避免每次标签事件（如仅标题更新）都触发全量重渲染。
      if (structuralSignature(nextBoundTabIds) !== structuralSignature(ctx.get().boundTabIds)) {
        ctx.set({ boundTabIds: nextBoundTabIds });
      }
      // 降级状态按分区记账：不得直接复位全局 storageDegraded —— 其它分区
      // （folders/pins）可能仍处降级，一次成功的绑定写不能把它们的告警连坐抹掉。
      if (!result.persisted) {
        ctx.reportPersistenceFailure(
          BINDINGS_SCOPE,
          '会话绑定未能持久化，面板重启后挂起条目绑定将丢失'
        );
      } else {
        ctx.clearDegraded(BINDINGS_SCOPE);
      }
    }
  };
}
