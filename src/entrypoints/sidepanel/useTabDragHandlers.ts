import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import type { DragEndEvent } from '@dnd-kit/core';
import type { TemporarySection } from '@/core/site/Sections';
import { computeReorderIndex, moveTab } from '@/platform/tabs';
import { useDataStore, type AddTabsToFolderResult } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import {
  DragType,
  FIXED_AREA_DROPPABLE,
  PINNED_STRIP_DROPPABLE,
  isSameContainer,
  type DragData,
  type SectionDragData
} from '@/ui/dnd/types';
import { CREATE_FOLDER_REQUEST_EVENT } from '@/ui/fixed/FixedArea';

/**
 * 拖拽分发 hook：把 dnd-kit 的 onDragEnd 按 DragData 类型分派到
 * 排序 / 跨容器投放 / 建文件夹 / 固定等逻辑。
 *
 * 设计：所有 handler 都是事件驱动（仅在拖拽结束时调用），不订阅渲染期数据，
 * 一律经 store getState 读取最新状态，因此引用稳定（useCallback 空/少量依赖），
 * 不会导致下游 memo 组件失效。restSections 是渲染期计算值，经 ref 保持最新。
 */
export function useTabDragHandlers(restSections: readonly TemporarySection[]) {
  const { t } = useTranslation();
  const sectionsRef = useRef(restSections);
  sectionsRef.current = restSections;

  /** 拖拽落点相对位置：纵向列表用 Y（在下方 = 插后），横向磁贴用 X（在右侧 = 插后）。 */
  const isPlaceAfter = useCallback((event: DragEndEvent): boolean => {
    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect;
    if (!activeRect || !overRect) return true;
    const activeData = event.active.data.current as DragData | undefined;
    if (activeData?.type === DragType.Pin) {
      return activeRect.left + activeRect.width / 2 > overRect.left + overRect.width / 2;
    }
    return activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2;
  }, []);

  /** 拖拽重排：用当前全部标签计算目标原生索引并写回浏览器。 */
  const handleReorder = useCallback((sourceId: number, targetId: number, placeAfter: boolean) => {
    const allTabs = useTabStore.getState().tabs;
    const index = computeReorderIndex({ tabs: allTabs, sourceId, targetId, placeAfter });
    // 拖拽过程中目标标签可能已被关闭：失败静默（下一帧快照自愈），不产生未捕获 rejection。
    if (index >= 0) void moveTab(sourceId, index).catch(() => {});
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

  /** 分组头排序：按目标组首/末 tab 的真实索引换算 Chrome tabGroups.move 目标。 */
  const handleSectionReorder = useCallback(
    (activeData: SectionDragData, overData: SectionDragData) => {
      if (activeData.groupId === undefined || overData.groupId === undefined) return;
      const sections = sectionsRef.current;
      const oldIndex = sections.findIndex((s) => s.key === activeData.sectionKey);
      const newIndex = sections.findIndex((s) => s.key === overData.sectionKey);
      if (oldIndex < 0 || newIndex < 0) return;
      const overSection = sections[newIndex];
      if (!overSection || overSection.kind !== 'native' || overSection.tabs.length === 0) return;
      const overFirst = overSection.tabs[0]!.index;
      const overLast = overSection.tabs.at(-1)!.index;
      // 前移 → 插到目标组首 tab；后移 → 插到目标组末 tab + 1。
      // 组可能在拖拽过程中被解散：失败静默（快照自愈），不产生未捕获 rejection。
      void useTabStore
        .getState()
        .moveGroup(activeData.groupId, newIndex < oldIndex ? overFirst : overLast + 1)
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

      // 标签：跨容器排序（受排序开关控制）/ 拖入文件夹 / 拖到固定空间空白（建文件夹）/ 拖到顶部固定区（固定）。
      if (activeData.type === DragType.Tab) {
        if (overData?.type === DragType.Tab) {
          if (dataStore.settings.tabOrderSync) {
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
              // 目标组可能刚被解散：失败静默（保持未分组），不产生未捕获 rejection。
              void browser.tabs
                .group({ tabIds: [sourceTab.id], groupId: overTab.groupId })
                .catch(() => {});
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
          handleSectionReorder(activeData, overData);
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
          void dataStore.reorderFolderItems(
            activeData.folderId,
            activeData.itemId,
            overData.itemId,
            isPlaceAfter(event)
          );
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
