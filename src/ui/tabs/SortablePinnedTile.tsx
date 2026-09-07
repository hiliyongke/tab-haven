import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import type { PersistentPin } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { useTabStore } from '@/stores/tabStore';
import { PinnedTile } from '@/ui/tabs/PinnedTile';
import { DragType } from '@/ui/dnd/types';

/** 固定标签磁贴的运行时状态（合并当前打开的标签：active / audible / discarded）。 */
export interface PinRuntime {
  openTab?: TabRecord;
  isActive: boolean;
  isAudible: boolean;
  isDiscarded: boolean;
}

/** 合并当前窗口内匹配该 pin 的标签状态（与 openPin 激活逻辑一致：优先激活标签）。 */
export function resolvePinRuntime(pin: PersistentPin, tabs: readonly TabRecord[]): PinRuntime {
  const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
  const openTab = matches.find((tab) => tab.active) ?? matches[0];
  return {
    openTab,
    isActive: openTab?.active ?? false,
    isAudible: openTab?.audible ?? false,
    isDiscarded: openTab?.discarded ?? false
  };
}

/**
 * 中键关闭工具：批量关闭与该 pin 关联的所有当前打开标签。
 */
export function makePinMiddleClickHandler(
  closeTabs: ReturnType<typeof useTabStore.getState>['closeTabs']
) {
  return (pin: PersistentPin) => {
    const tabs = useTabStore.getState().tabs;
    const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
    if (matches.length > 0) void closeTabs(matches.map((tab) => tab.id));
  };
}

/**
 * dnd-kit 排序版本的固定磁贴（共用给顶部 PinnedStrip 与 SectionList 内的浏览器置顶组）。
 * 父级必须包 `<SortableContext items={ids} strategy={rectSortingStrategy}>`。
 *
 * `pinId` 与 `tabId` 二选一：
 *  - PinnedStrip（持久化固定）传 pinId，排序走 dataStore.reorderPins
 *  - SectionList 内浏览器原生置顶组传 tabId，排序走 chrome.tabs.move
 */
export function SortablePinnedTile({
  id,
  title,
  url,
  favIconUrl,
  isActive = false,
  isAudible = false,
  isDiscarded = false,
  pinId,
  tabId,
  onOpen,
  onMiddleClick,
  onUnpin,
  onDuplicate,
  unpinTitle
}: {
  id: string | number;
  title: string;
  url?: string;
  favIconUrl?: string;
  isActive?: boolean;
  isAudible?: boolean;
  isDiscarded?: boolean;
  /** 持久化 pin id（PinnedStrip 场景）。 */
  pinId?: string;
  /** 浏览器原生标签 id（SectionList 内浏览器置顶场景）。 */
  tabId?: number;
  onOpen: () => void;
  onMiddleClick: () => void;
  onUnpin: () => void;
  onDuplicate?: () => void;
  unpinTitle: string;
}) {
  const sortable = useSortable({
    id,
    // 同 TabRow：关掉让位过渡，避免动画期间矩形漂移导致落点不准。
    transition: null,
    data: { type: DragType.Pin, pinId, tabId, title, favIconUrl }
  });

  return (
    <PinnedTile
      title={title}
      favIconUrl={favIconUrl}
      url={url}
      isActive={isActive}
      isDiscarded={isDiscarded}
      isAudible={isAudible}
      onClick={onOpen}
      onMiddleClick={onMiddleClick}
      onUnpin={onUnpin}
      onDuplicate={onDuplicate}
      unpinTitle={unpinTitle}
      sortable={{
        setNodeRef: sortable.setNodeRef,
        attributes: sortable.attributes,
        listeners: sortable.listeners,
        style: {
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition
        },
        isDragging: sortable.isDragging
      }}
    />
  );
}
