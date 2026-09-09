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

/** 无匹配标签时的运行时（模块级常量：避免每次渲染新建对象击穿下游 memo）。 */
export const CLOSED_PIN_RUNTIME: PinRuntime = Object.freeze({
  isActive: false,
  isAudible: false,
  isDiscarded: false
});

/**
 * 批量解析：一次遍历建「身份 → 运行时」索引。
 *
 * 逐个解析的复杂度是 O(磁贴数 × 标签数)，且每个标签的 pinIdentity 会被重复计算。
 * 顶部磁贴条在每次标签快照都重算一遍，是这个量级下最该消除的浪费。
 * 建索引后为 O(磁贴数 + 标签数)。
 */
export function buildPinRuntimeIndex(tabs: readonly TabRecord[]): Map<string, PinRuntime> {
  const byIdentity = new Map<string, PinRuntime>();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const identity = pinIdentity(tab.url);
    if (identity === null) continue;
    const existing = byIdentity.get(identity);
    // 激活标签优先（与 openPin 激活逻辑一致），否则保留首个。
    if (existing && (existing.isActive || !tab.active)) continue;
    byIdentity.set(identity, {
      openTab: tab,
      isActive: tab.active ?? false,
      isAudible: tab.audible ?? false,
      isDiscarded: tab.discarded ?? false
    });
  }
  return byIdentity;
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
