import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DragEndEvent } from '@dnd-kit/core';
import { reorderBlockedReason } from '@/core/site/reorderCapability';
import {
  computeGroupMoveIndex,
  computeReorderIndex,
  groupTabs,
  moveTab,
  moveTabs
} from '@/platform/tabs';
import { useDataStore, type AddTabsToFolderResult } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import {
  DragType,
  FIXED_AREA_DROPPABLE,
  PINNED_STRIP_DROPPABLE,
  isSameContainer,
  type DragData,
  type SectionDragData
} from '@/ui/dnd/types';
import { CREATE_FOLDER_REQUEST_EVENT } from '@/ui/fixed/events';

/** 落点是否属于固定空间（文件夹 / 固定条目 / 固定图标 / 两处空白投放区）。 */
function isFixedSpaceTarget(overId: string | number, overData?: DragData): boolean {
  return (
    overId === FIXED_AREA_DROPPABLE ||
    overId === PINNED_STRIP_DROPPABLE ||
    overData?.type === DragType.Folder ||
    overData?.type === DragType.FolderItem ||
    overData?.type === DragType.Pin
  );
}

/**
 * 拖拽分发 hook：把 dnd-kit 的 onDragEnd 按 DragData 类型分派到
 * 排序 / 跨容器投放 / 建文件夹 / 固定等逻辑。
 *
 * 设计：所有 handler 都是事件驱动（仅在拖拽结束时调用），不订阅渲染期数据，
 * 一律经 store getState 读取最新状态，因此引用稳定（useCallback 空/少量依赖），
 * 不会导致下游 memo 组件失效。排序所需的分区成员由拖拽数据自带的 tabIds 提供，
 * 因此本 hook 不接收渲染期的分区列表。
 */
export function useTabDragHandlers() {
  const { t } = useTranslation();

  /**
   * 落点方向：**由 dnd-kit 的 sortable index 判定，不做几何比较。**
   *
   * dnd-kit 已基于 SortableContext 的 items 顺序算出 active / over 的 index，
   * 插入位动画也是据此绘制的。直接复用它，落点与所见必然一致。
   *
   * 此前另用矩形中心比一次（纵向比 Y、横向磁贴比 X），等于把落点算了两遍：
   * 一套按 items 顺序、一套按屏幕矩形。两者不一致就表现为「动画显示在 A、
   * 实际落到 B」，以及需要停留一下 / 偏一点才命中。
   *
   * 后移（to > from）→ 落到 over 之后；前移（to < from）→ 落到 over 之前。
   * 这与 arrayMove(items, from, to) 一致：over 总被挤到源的相邻位。
   */
  const isPlaceAfter = useCallback((event: DragEndEvent): boolean => {
    const from = (event.active.data.current as { sortable?: { index?: number } } | undefined)
      ?.sortable?.index;
    const to = (event.over?.data.current as { sortable?: { index?: number } } | undefined)?.sortable
      ?.index;
    // 索引缺失（非 sortable 目标，如跨容器投到 fixed-area）时退回「插后」。
    if (from === undefined || to === undefined) return true;
    return to > from;
  }, []);

  /** 拖拽重排：用当前全部标签计算目标原生索引，先本地生效再写回浏览器。 */
  const handleReorder = useCallback((sourceId: number, targetId: number, placeAfter: boolean) => {
    const allTabs = useTabStore.getState().tabs;
    const index = computeReorderIndex({ tabs: allTabs, sourceId, targetId, placeAfter });
    if (index < 0) return;
    // 乐观更新：先让本地顺序立即生效，再写浏览器。真相源仍在浏览器——
    // 写失败或期间有并发变化时，下一次快照会把顺序校正回来（见 tabStore.applyReorder）。
    useTabStore.getState().applyReorder(sourceId, index);
    // 失败矫正：move 失败（索引越界/并发变化，而非标签被关闭）不产生任何 tabs 事件，
    // 快照不会自愈，本地顺序会与浏览器长期分叉 —— 必须主动刷新校正。
    void moveTab(sourceId, index)
      .then((ok) => {
        if (!ok) tabSyncService.requestRefresh();
      })
      .catch(() => {});
  }, []);

  /** 键盘重排（Alt+↑/↓）：把标签向相邻展示位置移动。 */
  const handleMoveTab = useCallback(
    (tabId: number, direction: -1 | 1) => {
      if (!useDataStore.getState().settings.tabOrderSync) return;
      const allTabs = useTabStore.getState().tabs;
      const idx = allTabs.findIndex((tab) => tab.id === tabId);
      if (idx < 0) return;
      const target = allTabs[idx + direction];
      if (!target) return;
      handleReorder(tabId, target.id, direction > 0);
    },
    [handleReorder]
  );

  /** 拖标签/分组到固定空间空白区：请求 FixedArea 弹出命名弹窗。 */
  const requestCreateFolder = useCallback((name: string, tabIds: number[]) => {
    window.dispatchEvent(
      new CustomEvent<{ name: string; tabIds: number[] }>(CREATE_FOLDER_REQUEST_EVENT, {
        detail: { name, tabIds }
      })
    );
  }, []);

  /**
   * 拖入收藏夹的落位反馈。
   *
   * 纯「移动」场景（无新增、无跳过）用简洁文案「已移入收藏夹」；
   * 其余场景才用逐项计数的 fixed.dropResult —— 否则最常见的「拖 1 个标签进收藏夹」
   * 会弹出「新增 0 个，移动 1 个，跳过 0 个」这种把内部计数泄漏给用户的别扭文案。
   */
  const notifyDropResult = useCallback(
    (result: AddTabsToFolderResult) => {
      const { notify } = useUndoStore.getState();
      if (result.skipped === 0 && result.added === 0 && result.moved > 0) {
        notify(t('toast.movedToFolder'));
        return;
      }
      notify(t('fixed.dropResult', { ...result }));
    },
    [t]
  );

  /**
   * 分区头排序：把 source 分区整体搬到 target 分区之前/之后。
   *
   * 落点用 computeGroupMoveIndex 统一计算（先剔除 source 整组再定位），
   * 避免旧实现「用移动前的快照索引 + 方向猜前后」带来的 off-by-N。
   *
   * 两类分区的落库路径不同，但都必须落到底层真实顺序，否则下一次派生就会被覆盖：
   *  - 双方都是原生组 → chrome.tabGroups.move，由浏览器维护组序；
   *  - 虚拟分区（站点组 / 语言组，无 groupId）及混合场景 → 整组标签连续 move。
   *    其展示顺序由组内标签 index 决定，整组搬家即真正改变分区顺序并持久。
   */
  const handleSectionReorder = useCallback(
    (activeData: SectionDragData, overData: SectionDragData, placeAfter: boolean) => {
      // 自投放无意义：source 与 target 同区，位置不变。
      if (activeData.sectionKey === overData.sectionKey) return;
      const allTabs = useTabStore.getState().tabs;
      const liveIds = new Set(allTabs.map((tab) => tab.id));
      const sourceTabIds = activeData.tabIds.filter((id) => liveIds.has(id));
      const targetTabIds = overData.tabIds.filter((id) => liveIds.has(id));
      // 拖拽期间分区可能被关闭/解散：静默放弃，下一帧快照自愈。
      if (sourceTabIds.length === 0 || targetTabIds.length === 0) return;

      const index = computeGroupMoveIndex({
        tabs: allTabs,
        sourceTabIds,
        targetTabIds,
        placeAfter
      });
      if (index < 0) return;

      // 乐观更新：整组先本地生效。两条落库路径（tabGroups.move / 整组 tabs.move）
      // 改动的是同一批标签的 index，所以放在分支之前统一处理。
      useTabStore.getState().applyGroupReorder(sourceTabIds, index);

      if (activeData.groupId !== undefined && overData.groupId !== undefined) {
        void useTabStore
          .getState()
          .moveGroup(activeData.groupId, index)
          .catch(() => {});
        return;
      }
      // 与 handleReorder 同理：失败无事件、不自愈，需主动刷新校正。
      void moveTabs(sourceTabIds, index)
        .then((ok) => {
          if (!ok) tabSyncService.requestRefresh();
        })
        .catch(() => {});
    },
    []
  );

  /** 全局 dnd-kit 拖拽结束：按 data 类型分派排序 / 跨容器投放。 */
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeData = active.data.current as DragData | undefined;
      const overData = over.data.current as DragData | undefined;
      if (!activeData) return;
      const { notify } = useUndoStore.getState();
      const dataStore = useDataStore.getState();
      // 导入事务进行中：固定空间（文件夹/固定图标）的写入会被有意丢弃，以防与事务的
      // 串行写交错。此时投进固定空间只会「看起来没反应」，必须明确拒绝并说明原因，
      // 而不是让用户以为扩展卡住或数据丢了。临时区排序不受影响，故只拦固定空间目标。
      if (dataStore.importing && isFixedSpaceTarget(over.id, overData)) {
        notify(t('fixed.importingBusy'));
        return;
      }
      // 列表内排序是否被阻断：统一判定，UI 与拖拽分发共用同一口径
      // （详见 core/site/reorderCapability）。
      const blocked = reorderBlockedReason({
        tabOrderSync: dataStore.settings.tabOrderSync,
        sortMode: dataStore.settings.sortMode
      });

      // 标签：跨容器排序（受排序开关控制）/ 拖入文件夹 / 拖到固定空间空白（建文件夹）/ 拖到顶部固定区（固定）。
      if (activeData.type === DragType.Tab) {
        if (overData?.type === DragType.Tab) {
          if (dataStore.settings.tabOrderSync) {
            // recency 下显示顺序与 index 已解耦，拖了不会反映到界面，必须告知。
            if (blocked === 'recency') {
              notify(t('tabs.orderLockedBySortMode'));
              return;
            }
            // 任一侧行处于「超阈值强制虚拟化」分区（canReorder=false，UI 已提示
            // 排序暂停）时拦截真实排序：行拖拽仍可跨容器拖到固定空间，但 Tab→Tab
            // 落点必须忽略——否则出现「提示已暂停、松手却真的重排」的行为矛盾。
            if (activeData.canReorder === false || overData.canReorder === false) {
              notify(t('tabs.largeListNotice'));
              return;
            }
            handleReorder(activeData.tabId, overData.tabId, isPlaceAfter(event));
            // 跨原生组：把 source 标签加入目标组（moveTab 只改位置不改归属）。
            const latest = useTabStore.getState().tabs;
            const sourceTab = latest.find((candidate) => candidate.id === activeData.tabId);
            const overTab = latest.find((candidate) => candidate.id === overData.tabId);
            if (
              sourceTab &&
              overTab &&
              overTab.groupId !== undefined &&
              overTab.groupId >= 0 &&
              sourceTab.groupId !== overTab.groupId
            ) {
              // 目标组可能刚被解散：groupTabs 内部降级记录并保持未分组。
              void groupTabs([sourceTab.id], overTab.groupId);
            }
          }
          return;
        }
        if (overData?.type === DragType.FolderItem || overData?.type === DragType.Folder) {
          const target = useTabStore
            .getState()
            .tabs.find((candidate) => candidate.id === activeData.tabId);
          if (target) {
            void dataStore
              .addTabsToFolder([target], overData.folderId)
              .then(notifyDropResult)
              .catch(() => notify(t('errors.operationFailed')));
          }
          return;
        }
        if (over.id === FIXED_AREA_DROPPABLE) {
          const tab = useTabStore
            .getState()
            .tabs.find((candidate) => candidate.id === activeData.tabId);
          if (tab) requestCreateFolder(tab.title || t('tabs.untitled'), [tab.id]);
          return;
        }
        if (overData?.type === DragType.Pin || over.id === PINNED_STRIP_DROPPABLE) {
          const tab = useTabStore
            .getState()
            .tabs.find((candidate) => candidate.id === activeData.tabId);
          if (tab) void dataStore.addPin(tab);
        }
        return;
      }

      // 分组：同容器排序 / 拖入文件夹 / 拖到固定空间空白（建文件夹）。
      if (activeData.type === DragType.Section) {
        if (overData?.type === DragType.Section && isSameContainer(activeData, overData)) {
          // 与标签排序共用同一道闸门：双向同步关闭时不写回浏览器，排序无从持久化。
          if (dataStore.settings.tabOrderSync) {
            // 同上：recency 下分区顺序同样与 index 解耦，必须显式告知。
            if (blocked === 'recency') {
              notify(t('tabs.orderLockedBySortMode'));
              return;
            }
            handleSectionReorder(activeData, overData, isPlaceAfter(event));
          }
          return;
        }
        if (overData?.type === DragType.FolderItem || overData?.type === DragType.Folder) {
          const targetTabs = useTabStore
            .getState()
            .tabs.filter((tab) => activeData.tabIds.includes(tab.id));
          if (targetTabs.length > 0) {
            void dataStore
              .addTabsToFolder(targetTabs, overData.folderId)
              .then(notifyDropResult)
              .catch(() => notify(t('errors.operationFailed')));
          }
          return;
        }
        if (over.id === FIXED_AREA_DROPPABLE) {
          requestCreateFolder(activeData.title, activeData.tabIds);
        }
        return;
      }

      // 固定条目：同文件夹排序 / 跨文件夹移动。
      if (activeData.type === DragType.FolderItem) {
        if (overData?.type === DragType.FolderItem && isSameContainer(activeData, overData)) {
          void dataStore.reorderFolderItems({
            folderId: activeData.folderId,
            sourceId: activeData.itemId,
            targetId: overData.itemId,
            placeAfter: isPlaceAfter(event)
          });
          return;
        }
        // 跨文件夹：拖到目标文件夹（或其条目）上时，把条目移入目标文件夹。
        const targetFolderId =
          overData?.type === DragType.Folder
            ? overData.folderId
            : overData?.type === DragType.FolderItem && overData.folderId !== activeData.folderId
              ? overData.folderId
              : undefined;
        if (targetFolderId !== undefined) {
          void dataStore
            .moveFolderItem(activeData.folderId, activeData.itemId, targetFolderId)
            .then(() => notify(t('toast.folderItemMoved')))
            .catch(() => notify(t('errors.operationFailed')));
          return;
        }
        // 移出固定空间：拖到临时区（标签行 / 分组卡）时移除条目，标签随之回到临时区。
        if (overData?.type === DragType.Tab || overData?.type === DragType.Section) {
          void dataStore
            .removeFolderItem(activeData.folderId, activeData.itemId)
            .then(() => notify(t('toast.removedFromFolder')))
            .catch(() => notify(t('errors.operationFailed')));
        }
        return;
      }

      // 文件夹排序。
      if (activeData.type === DragType.Folder && overData?.type === DragType.Folder) {
        void dataStore.moveFolder(activeData.folderId, overData.folderId, isPlaceAfter(event));
        return;
      }

      // 顶部永久固定磁贴排序。
      // - 有 pinId：PinnedStrip 持久化 pin 排序（dataStore.reorderPins）。
      // - 有 tabId：SectionList 内浏览器原生置顶组排序（chrome.tabs.move 改浏览器位置）。
      if (activeData.type === DragType.Pin && overData?.type === DragType.Pin) {
        if (activeData.pinId !== undefined && overData.pinId !== undefined) {
          void dataStore.reorderPins(activeData.pinId, overData.pinId, isPlaceAfter(event));
        } else if (activeData.tabId !== undefined && overData.tabId !== undefined) {
          handleReorder(activeData.tabId, overData.tabId, isPlaceAfter(event));
        }
      }
    },
    [handleReorder, handleSectionReorder, isPlaceAfter, notifyDropResult, requestCreateFolder, t]
  );

  return { onDragEnd, handleReorder, handleMoveTab };
}
