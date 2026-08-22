import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import type { PersistentPin } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { PinnedTile } from '@/ui/tabs/PinnedTile';
import { DragType, PINNED_STRIP_DROPPABLE } from '@/ui/dnd/types';

/**
 * 顶部永久固定图标区（行为规格 C-2）：
 * 单击切换/重新打开；中键仅关闭页面、入口保留；拖标签到该区域固定。
 * 视觉语言：pinned-strip 磁贴（active 底部绿条、
 * closed 降透明度、audible 绿点、discarded 灰化、split 角标）。
 * 拖拽排序使用全局 dnd-kit（SortableContext 挂在外层 DndContext 下）。
 */

interface PinRuntime {
  openTab?: TabRecord;
  isActive: boolean;
  isAudible: boolean;
  isDiscarded: boolean;
}

function resolveRuntime(pin: PersistentPin, tabs: readonly TabRecord[]): PinRuntime {
  const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
  // 与 openPin 的激活逻辑一致：优先取当前激活的匹配标签，保证磁贴高亮准确。
  const openTab = matches.find((tab) => tab.active) ?? matches[0];
  return {
    openTab,
    isActive: openTab?.active ?? false,
    isAudible: openTab?.audible ?? false,
    isDiscarded: openTab?.discarded ?? false
  };
}

function SortablePinnedTile({
  pin,
  runtime,
  onOpen,
  onMiddleClick,
  onRemove,
  unpinTitle
}: {
  pin: PersistentPin;
  runtime: PinRuntime;
  onOpen: (pin: PersistentPin) => void;
  onMiddleClick: (pin: PersistentPin) => void;
  onRemove: (pin: PersistentPin) => void;
  unpinTitle: string;
}) {
  const sortable = useSortable({
    id: pin.id,
    data: { type: DragType.Pin, pinId: pin.id, title: pin.title, favIconUrl: pin.favIconUrl }
  });

  return (
    <PinnedTile
      title={pin.title}
      favIconUrl={pin.favIconUrl}
      url={pin.url}
      isActive={runtime.isActive}
      isDiscarded={runtime.isDiscarded}
      isAudible={runtime.isAudible}
      onClick={() => onOpen(pin)}
      onMiddleClick={() => onMiddleClick(pin)}
      onUnpin={() => onRemove(pin)}
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

export function PinnedStrip() {
  const { t } = useTranslation();
  const pins = useDataStore((state) => state.pins);
  const openPin = useDataStore((state) => state.openPin);
  const removePin = useDataStore((state) => state.removePin);
  const closeTabs = useTabStore((state) => state.closeTabs);
  const tabs = useTabStore((state) => state.tabs);
  const { isOver, setNodeRef } = useDroppable({
    id: PINNED_STRIP_DROPPABLE,
    data: { type: 'pinned-strip' }
  });

  if (pins.length === 0) return null;

  const handleMiddleClick = (pin: PersistentPin) => {
    const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
    if (matches.length > 0) void closeTabs(matches.map((tab) => tab.id));
  };

  return (
    <SortableContext items={pins.map((pin) => pin.id)} strategy={rectSortingStrategy}>
      <section
        ref={setNodeRef}
        className={'pinned-strip' + (isOver ? ' is-drop-target' : '')}
        aria-label={t('sections.pinned')}
        data-drop-label={t('fixed.dragToPin')}
      >
        {pins.map((pin) => (
          <SortablePinnedTile
            key={pin.id}
            pin={pin}
            runtime={resolveRuntime(pin, tabs)}
            onOpen={(target) => void openPin(target)}
            onMiddleClick={handleMiddleClick}
            onRemove={(target) => void removePin(target)}
            unpinTitle={t('fixed.removePin')}
          />
        ))}
      </section>
    </SortableContext>
  );
}
