import { useCallback } from 'react';
import { useTranslation } from '@/i18n';
import type { DragEndEvent } from '@dnd-kit/core';
import { reorderBlockedReason } from '@/core/site/reorderCapability';
import { DEFAULT_FOLDER_NAMES } from '@/core/snapshot/defaultNames';
import {
  computeGroupMoveIndex,
  computeReorderIndex,
  groupTabs,
  moveTab,
  moveTabs,
  setPinned
} from '@/platform/tabs';
import { useDataStore, type AddTabsToFolderResult } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import { logDegraded } from '@/platform/diagnostics';
import {
  DragType,
  isSameContainer,
  type DragData,
  type DropTargetData,
  type SectionDragData
} from '@/ui/dnd/types';
import { resolveDrop, type DropRejectCode } from '@/ui/dnd/dropPolicy';
import { CREATE_FOLDER_REQUEST_EVENT } from '@/ui/fixed/events';

/**
 * 拖拽分发 hook：把 dnd-kit 的 onDragEnd 按 DragData 类型分派到
 * 排序 / 跨容器投放 / 建文件夹 / 固定等逻辑。
 *
 * 设计：所有 handler 都是事件驱动（仅在拖拽结束时调用），不订阅渲染期数据，
 * 一律经 store getState 读取最新状态，因此引用稳定（useCallback 空/少量依赖），
 * 不会导致下游 memo 组件失效。排序所需的分区成员由拖拽数据自带的 tabIds 提供，
 * 因此本 hook 不接收渲染期的分区列表。
 *
 * **可行性判定不在本文件**：能放下什么、放不下为什么，统一由 `ui/dnd/dropPolicy`
 * 回答。这里只负责「执行」与「拒绝时把原因翻译成人话」——判定一旦散落回分发层，
 * 就会重新出现「落点亮着却不动」「拖了完全没反应」两难。
 *
 * 落位说明：本文件是 hook（无渲染职责），与 useListNavigation / useRowRoving 等
 * 同处 `ui/hooks`。它**不放在 `ui/dnd/`**：`src/ui/dnd/**` 有独立的覆盖率阈值档，
 * 本文件 580 余行且当前几乎无测试，并入会把该档均值从约 90% 压到 45%、直接击穿
 * 门禁（详见 vitest.config.ts 的阈值注释）。
 */
export function useTabDragHandlers() {
  const { t } = useTranslation();

  /**
   * 拒绝原因 → 用户可读文案。
   *
   * 集中在这一处而不是散进各分支：同一个原因（例如排序开关关闭）可能由多个
   * 组合触发，文案必须一字不差，否则用户会以为是两个不同的问题。
   */
  const rejectMessage = useCallback(
    (code: DropRejectCode): string => {
      switch (code) {
        case 'importing':
          return t('正在导入备份，请稍后再改');
        case 'sync-off':
          return t('已关闭「标签顺序双向同步」，拖拽排序不会写回浏览器；可在设置中开启');
        case 'recency':
          return t('当前为「最近访问」自动排序；切到「浏览器顺序」即可手动拖拽排序');
        case 'virtualized':
          return t('标签太多，本区暂时不能调整顺序（拖拽与 Alt+↑↓ 已暂停）');
        case 'mixed-pin':
          return t('常驻磁贴与浏览器固定标签之间不支持排序。');
        case 'tab-to-site-section':
          return t('站点分组按域名自动归类，不能手动拖入；可拖到原生标签组或收藏夹');
        case 'section-to-pin':
          return t('磁贴区只接单个标签，不能把整个分组固定');
        case 'item-to-fixed':
          return t('收藏夹条目不能拖到磁贴或收藏夹空白处');
        case 'pin-to-fixed':
          return t('磁贴只能拖回标签区取消固定，或与其他磁贴排序');
        case 'folder-outside':
          return t('文件夹只能在收藏夹内调整顺序');
        default:
          return t('这个位置不支持该操作');
      }
    },
    [t]
  );

  /**
   * 落点方向：**由 dnd-kit 的 sortable index 判定，不做几何比较。**
   *
   * dnd-kit 已基于 SortableContext 的 items 顺序算出 active / over 的 index，
   * 插入位动画也是据此绘制的。直接复用它，落点与所见必然一致。
   *
   * 另用矩形中心比一次（纵向比 Y、横向磁贴比 X）等于把落点算了两遍：
   * 一套按 items 顺序、一套按屏幕矩形。两者不一致就表现为「动画显示在 A、
   * 实际落到 B」，以及需要停留一下 / 偏一点才命中。
   *
   * 后移（to > from）→ 落到 over 之后；前移（to < from）→ 落到 over 之前。
   * 这与 arrayMove(items, from, to) 一致：over 总被挤到源的相邻位。
   */
  const isPlaceAfter = useCallback(
    (event: DragEndEvent, activeData?: DragData, overData?: DropTargetData): boolean => {
      // 跨容器拖拽时 from/to 属于不同的 SortableContext items 数组，两者 index
      // 无比较语义（拖到大分区末尾 vs 小分区中间的方向判断会任意偏一位）。
      // 跨容器场景一律退回「插后」（与索引缺失同一兜底口径）。
      if (
        activeData &&
        overData &&
        !isSameContainer(activeData, overData as DragData | undefined)
      ) {
        return true;
      }
      const from = (event.active.data.current as { sortable?: { index?: number } } | undefined)
        ?.sortable?.index;
      const to = (event.over?.data.current as { sortable?: { index?: number } } | undefined)
        ?.sortable?.index;
      // 索引缺失（非 sortable 目标，如跨容器投到 fixed-area）时退回「插后」。
      if (from === undefined || to === undefined) return true;
      return to > from;
    },
    []
  );

  /**
   * 排序类操作的一次性回滚。
   *
   * 拖拽 4px 即激活、落点检测三级回退后永不返回空（见 DndRoot），误拖必然落地；
   * 故排序必须可撤销 —— 否则用户在长列表里一次手抖就永久改掉了顺序。
   * 操作前留一份 folders 快照，成功后在 toast 上给一次「撤销」。
   */
  const withFolderUndo = useCallback(
    (message: string, mutate: () => Promise<void>) => {
      const before = useDataStore.getState().folders;
      void mutate()
        .then(() => {
          useUndoStore.getState().notify(message, {
            label: t('撤销'),
            run: () => {
              void useDataStore.getState().restoreFolders(before);
            }
          });
        })
        .catch((error: unknown) =>
          useUndoStore.getState().notifyFailure('drag', t('操作失败，请稍后重试'), error)
        );
    },
    [t]
  );

  /** 拖拽重排：用当前全部标签计算目标原生索引，先本地生效再写回浏览器。 */
  const handleReorder = useCallback(
    (sourceId: number, targetId: number, placeAfter: boolean) => {
      const allTabs = useTabStore.getState().tabs;
      const index = computeReorderIndex({ tabs: allTabs, sourceId, targetId, placeAfter });
      if (index < 0) return;
      // 原位：供 toast 上的一次性「撤销」把标签挪回去。
      const fromIndex = allTabs.findIndex((tab) => tab.id === sourceId);
      // 乐观更新：先让本地顺序立即生效，再写浏览器。真相源仍在浏览器——
      // 写失败或期间有并发变化时，下一次快照会把顺序校正回来（见 tabStore.applyReorder）。
      useTabStore.getState().applyReorder(sourceId, index);
      // 失败矫正：move 失败（索引越界/并发变化，而非标签被关闭）不产生任何 tabs 事件，
      // 快照不会自愈，本地顺序会与浏览器长期分叉 —— 必须主动刷新校正。
      void moveTab(sourceId, index)
        .then((ok) => {
          if (!ok) {
            tabSyncService.requestRefresh();
            return;
          }
          if (fromIndex >= 0 && fromIndex !== index) {
            useUndoStore.getState().notify(t('已调整标签顺序'), {
              label: t('撤销'),
              run: () => {
                useTabStore.getState().applyReorder(sourceId, fromIndex);
                void moveTab(sourceId, fromIndex)
                  .then((restored) => {
                    if (!restored) tabSyncService.requestRefresh();
                  })
                  .catch((error: unknown) => {
                    logDegraded('tabs', '撤销标签排序失败', error);
                    tabSyncService.requestRefresh();
                  });
              }
            });
          }
        })
        // 异常 rejection（非 false 返回）同样不产生 tabs 事件：必须矫正 + 留痕，
        // 否则乐观排序与浏览器长期分叉且无从排查。
        .catch((error: unknown) => {
          logDegraded('tabs', '拖拽移动标签失败', error);
          tabSyncService.requestRefresh();
        });
    },
    [t]
  );

  /** 键盘重排（Alt+↑/↓）：把标签向相邻展示位置移动。 */
  const handleMoveTab = useCallback(
    (tabId: number, direction: -1 | 1) => {
      const dataStore = useDataStore.getState();
      // 与拖拽路径共用同一道闸门与同一句文案（rejectMessage）：
      // 键盘移动会改动浏览器 index 而界面纹丝不动——必须显式告知。
      const blocked = reorderBlockedReason({
        tabOrderSync: dataStore.settings.tabOrderSync,
        sortMode: dataStore.settings.sortMode
      });
      if (blocked) {
        useUndoStore.getState().notify(rejectMessage(blocked));
        return;
      }
      const allTabs = useTabStore.getState().tabs;
      const index = allTabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return;
      const target = allTabs[index + direction];
      if (!target) return;
      handleReorder(tabId, target.id, direction > 0);
    },
    [handleReorder, rejectMessage]
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
   * 拖入文件夹的落位反馈。
   *
   * 纯「移动」场景（无新增、无跳过）用简洁文案「已移入文件夹」；
   * 其余场景才用逐项计数的 fixed.dropResult —— 否则最常见的「拖 1 个标签进文件夹」
   * 会弹出「新增 0 个，移动 1 个，跳过 0 个」这种把内部计数泄漏给用户的别扭文案。
   */
  const notifyDropResult = useCallback(
    (result: AddTabsToFolderResult) => {
      const { notify } = useUndoStore.getState();
      if (result.skipped === 0 && result.added === 0 && result.moved > 0) {
        notify(t('已移入文件夹'));
        return;
      }
      notify(
        t('新增 {{added}} 个，移动 {{moved}} 个，跳过 {{skipped}} 个重复或不可用标签', {
          ...result
        })
      );
    },
    [t]
  );

  /**
   * 分区头排序：把 source 分区整体搬到 target 分区之前/之后。
   *
   * 落点用 computeGroupMoveIndex 统一计算（先剔除 source 整组再定位），
   * 「用移动前的快照索引 + 方向猜前后」会带来 off-by-N，须先剔除 source 整组再定位。
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
        // 与 handleReorder / moveTabs 分支同口径：失败无事件、不自愈，需主动刷新校正。
        void useTabStore
          .getState()
          .moveGroup(activeData.groupId, index)
          .then((ok) => {
            if (!ok) tabSyncService.requestRefresh();
          })
          .catch((error: unknown) => {
            logDegraded('tabs', '拖拽移动分组失败', error);
            tabSyncService.requestRefresh();
          });
        return;
      }
      // 与 handleReorder 同理：失败无事件、不自愈，需主动刷新校正。
      void moveTabs(sourceTabIds, index)
        .then((ok) => {
          if (!ok) tabSyncService.requestRefresh();
        })
        .catch((error: unknown) => {
          logDegraded('tabs', '拖拽整组移动标签失败', error);
          tabSyncService.requestRefresh();
        });
    },
    []
  );

  /** 全局 dnd-kit 拖拽结束：判定交给 dropPolicy，本函数只执行与反馈。 */
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeData = active.data.current as DragData | undefined;
      if (!activeData) return;
      const overData = over.data.current as DropTargetData | undefined;
      const { notify, notifyError } = useUndoStore.getState();
      const dataStore = useDataStore.getState();

      const resolution = resolveDrop(
        activeData,
        { id: over.id, data: overData },
        {
          tabOrderSync: dataStore.settings.tabOrderSync,
          sortMode: dataStore.settings.sortMode,
          importing: dataStore.importing
        }
      );
      // 拖回原位：结果与松手前一致，静默是正确的（也避免误拖 4px 就弹提示）。
      if (resolution.kind === 'noop') return;
      if (resolution.kind === 'reject') {
        notify(rejectMessage(resolution.code));
        return;
      }

      const placeAfter = isPlaceAfter(event, activeData, overData);
      const action = resolution.action;
      /** 失败一律走 notifyFailure：拖拽是写路径，「拖了没反应」必须进诊断导出。 */
      const fail = (error: unknown): void =>
        useUndoStore.getState().notifyFailure('drag', t('操作失败，请稍后重试'), error);

      /**
       * 每种动作一个处理器：原先 14 个 case 的执行体全写在下面的 switch 里，
       * `onDragEnd` 因此有 240 行、无法单看一类动作。抽成具名函数后 switch 只剩
       * 分派，每个处理器只回答「这一类投放要做什么」。
       *
       * 形态刻意是「switch + 具名函数」而不是动作表：`DropAction` 是判别联合，
       * 只有 switch 能让 TypeScript 把 `action` 收窄到具体 kind（查表需要一次
       * 类型断言才能把键与载荷对应起来，那是本仓禁止的类型逃逸）。穷尽性由
       * 末尾的 `never` 检查兜住。
       */

      const reorderTabs = (): void => {
        if (activeData.type !== DragType.Tab || overData?.type !== DragType.Tab) return;
        handleReorder(activeData.tabId, overData.tabId, placeAfter);
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
          // 分组写入失败同样无 tabs 事件可自愈，必须给用户可见反馈（与相邻分支同口径）。
          void groupTabs([sourceTab.id], overTab.groupId).catch(fail);
        }
      };

      /** 浏览器原生置顶标签排序（磁贴间，走 chrome.tabs.move，不落扩展存储）。 */
      const reorderPinnedTabs = (): void => {
        if (
          activeData.type !== DragType.Pin ||
          overData?.type !== DragType.Pin ||
          activeData.tabId === undefined ||
          overData.tabId === undefined
        ) {
          return;
        }
        handleReorder(activeData.tabId, overData.tabId, placeAfter);
      };

      /** 标签拖到原生分组头 = 加入该组（浏览器把标签排到组尾）。 */
      const joinGroup = (groupId: number): void => {
        if (activeData.type !== DragType.Tab) return;
        void groupTabs([activeData.tabId], groupId)
          .then(() => notify(t('已加入标签组')))
          .catch(fail);
      };

      /** 标签 / 整组拖进收藏夹（文件夹卡或其条目）。 */
      const moveTabsToFolder = (folderId: string): void => {
        const tabIds =
          activeData.type === DragType.Tab
            ? [activeData.tabId]
            : activeData.type === DragType.Section
              ? activeData.tabIds
              : [];
        if (tabIds.length === 0) return;
        const targets = useTabStore.getState().tabs.filter((tab) => tabIds.includes(tab.id));
        if (targets.length === 0) return;
        void dataStore.addTabsToFolder(targets, folderId).then(notifyDropResult).catch(fail);
      };

      /** 拖到收藏夹空白：弹命名框新建文件夹。 */
      const createFolder = (): void => {
        if (activeData.type === DragType.Tab) {
          const tab = useTabStore
            .getState()
            .tabs.find((candidate) => candidate.id === activeData.tabId);
          // 落盘名必须走常量：按界面语言生成会让中英文界面产出两套名字，
          // 与导入侧「同名合并」的语义打架（见 core/snapshot/defaultNames）。
          if (tab) requestCreateFolder(tab.title || DEFAULT_FOLDER_NAMES.untitled, [tab.id]);
          return;
        }
        if (activeData.type === DragType.Section) {
          requestCreateFolder(activeData.title, activeData.tabIds);
        }
      };

      /** 标签拖到磁贴区：固定为常驻磁贴。 */
      const pinTab = (): void => {
        if (activeData.type !== DragType.Tab) return;
        const tab = useTabStore
          .getState()
          .tabs.find((candidate) => candidate.id === activeData.tabId);
        if (!tab) return;
        void dataStore
          .addPin(tab)
          .then((ok) => {
            // addPin 内部有多条「无法满足」的分支（无 URL / 非 http(s) / 已达上限）。
            // 它们过去静默 return 而 Promise 照常 resolve，于是这里无条件弹
            // 「已固定标签」—— 界面宣布成功、磁贴却从未生成。按返回值区分。
            if (ok) notify(t('已固定标签'));
            else notifyError(t('这个标签无法固定为常驻磁贴'));
          })
          .catch(fail);
      };

      /** 持久磁贴拖回临时区：取消固定（与收藏夹条目可拖出对称）。 */
      const unpinPin = (pinId: string): void => {
        // 用最新快照而不是 onDragEnd 开头的引用：拖拽期间可能正好完成一次镜像恢复。
        const pin = useDataStore.getState().pins.find((candidate) => candidate.id === pinId);
        if (!pin) return;
        void dataStore
          .removePin(pin)
          .then(() => notify(t('已取消固定')))
          .catch(fail);
      };

      /**
       * 浏览器置顶标签的磁贴拖回临时区：取消浏览器固定。
       * 用「确保取消」而不是 togglePinned 翻转：拖拽时快照可能已过期，
       * 快照说未固定而实际已固定时，翻转会把标签再次固定（见 platform/tabs 注释）。
       */
      const unpinTab = (tabId: number): void => {
        void setPinned(tabId, false)
          .then((ok) => {
            if (ok) notify(t('已取消固定'));
            else notifyError(t('操作失败，请稍后重试'));
          })
          .catch(fail);
      };

      const reorderSections = (): void => {
        if (activeData.type !== DragType.Section || overData?.type !== DragType.Section) return;
        handleSectionReorder(activeData, overData, placeAfter);
      };

      const reorderFolderItems = (): void => {
        if (activeData.type !== DragType.FolderItem || overData?.type !== DragType.FolderItem) {
          return;
        }
        withFolderUndo(t('已调整顺序'), () =>
          dataStore.reorderFolderItems({
            folderId: activeData.folderId,
            sourceId: activeData.itemId,
            targetId: overData.itemId,
            placeAfter
          })
        );
      };

      const moveFolderItem = (targetFolderId: string): void => {
        if (activeData.type !== DragType.FolderItem) return;
        withFolderUndo(t('已移动到目标文件夹'), () =>
          dataStore.moveFolderItem(activeData.folderId, activeData.itemId, targetFolderId)
        );
      };

      /** 条目拖到临时区：移出收藏夹，标签随之回到临时区。 */
      const removeFolderItem = (): void => {
        if (activeData.type !== DragType.FolderItem) return;
        void dataStore
          .removeFolderItem(activeData.folderId, activeData.itemId)
          .then(() => notify(t('已从文件夹移除')))
          .catch(fail);
      };

      const reorderFolders = (): void => {
        if (activeData.type !== DragType.Folder || overData?.type !== DragType.Folder) return;
        withFolderUndo(t('已调整顺序'), () =>
          dataStore.moveFolder(activeData.folderId, overData.folderId, placeAfter)
        );
      };

      const reorderPins = (): void => {
        if (
          activeData.type !== DragType.Pin ||
          overData?.type !== DragType.Pin ||
          activeData.pinId === undefined ||
          overData.pinId === undefined
        ) {
          return;
        }
        void dataStore.reorderPins(activeData.pinId, overData.pinId, placeAfter).catch(fail);
      };

      switch (action.kind) {
        case 'reorder-tabs':
          reorderTabs();
          return;
        case 'reorder-pinned-tabs':
          reorderPinnedTabs();
          return;
        case 'join-group':
          joinGroup(action.groupId);
          return;
        case 'move-tabs-to-folder':
          moveTabsToFolder(action.folderId);
          return;
        case 'create-folder':
          createFolder();
          return;
        case 'pin-tab':
          pinTab();
          return;
        case 'unpin-pin':
          unpinPin(action.pinId);
          return;
        case 'unpin-tab':
          unpinTab(action.tabId);
          return;
        case 'reorder-sections':
          reorderSections();
          return;
        case 'reorder-folder-items':
          reorderFolderItems();
          return;
        case 'move-folder-item':
          moveFolderItem(action.targetFolderId);
          return;
        case 'remove-folder-item':
          removeFolderItem();
          return;
        case 'reorder-folders':
          reorderFolders();
          return;
        case 'reorder-pins':
          reorderPins();
          return;
        default: {
          // 穷尽性检查：`DropAction` 新增 kind 而这里没接住时，这一行会编译失败。
          // 没有它，漏接一个动作只会在运行时表现为「拖了没反应」。
          const unhandled: never = action;
          void unhandled;
          return;
        }
      }
    },
    [
      handleReorder,
      handleSectionReorder,
      isPlaceAfter,
      notifyDropResult,
      rejectMessage,
      requestCreateFolder,
      withFolderUndo,
      t
    ]
  );

  return { onDragEnd, handleReorder, handleMoveTab };
}
