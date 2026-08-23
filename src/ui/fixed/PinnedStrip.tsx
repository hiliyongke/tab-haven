import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import type { PersistentPin } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { PINNED_STRIP_DROPPABLE } from '@/ui/dnd/types';
import {
  SortablePinnedTile,
  makePinMiddleClickHandler,
  resolvePinRuntime
} from '@/ui/tabs/SortablePinnedTile';

/**
 * 顶部永久固定图标区（行为规格 C-2）：
 * 单击切换/重新打开；中键仅关闭页面、入口保留；拖标签到该区域固定。
 * 视觉语言：pinned-strip 磁贴（active 底部绿条、
 * closed 降透明度、audible 绿点、discarded 灰化、split 角标）。
 * 拖拽排序使用全局 dnd-kit（SortableContext 挂在外层 DndContext 下）。
 */
export function PinnedStrip() {
  const { t } = useTranslation();
  const pins = useDataStore((state) => state.pins);
  const pinnedStripSize = useDataStore((state) => state.settings.pinnedStripSize);
  const openPin = useDataStore((state) => state.openPin);
  const removePin = useDataStore((state) => state.removePin);
  const closeTabs = useTabStore((state) => state.closeTabs);
  const tabs = useTabStore((state) => state.tabs);
  const { isOver, setNodeRef } = useDroppable({
    id: PINNED_STRIP_DROPPABLE,
    data: { type: 'pinned-strip' }
  });

  if (pins.length === 0) return null;

  const handleMiddleClick = makePinMiddleClickHandler(closeTabs);
  const unpinTitle = t('fixed.removePin');

  return (
    <SortableContext items={pins.map((pin) => pin.id)} strategy={rectSortingStrategy}>
      <section
        ref={setNodeRef}
        className={'pinned-strip size-' + pinnedStripSize + (isOver ? ' is-drop-target' : '')}
        aria-label={t('sections.pinned')}
        data-drop-label={t('fixed.dragToPin')}
      >
        {pins.map((pin: PersistentPin) => {
          const runtime = resolvePinRuntime(pin, tabs);
          return (
            <SortablePinnedTile
              key={pin.id}
              id={pin.id}
              pinId={pin.id}
              title={pin.title}
              favIconUrl={pin.favIconUrl}
              url={pin.url}
              isActive={runtime.isActive}
              isAudible={runtime.isAudible}
              isDiscarded={runtime.isDiscarded}
              onOpen={() => void openPin(pin)}
              onMiddleClick={() => handleMiddleClick(pin)}
              onUnpin={() => void removePin(pin)}
              unpinTitle={unpinTitle}
            />
          );
        })}
      </section>
    </SortableContext>
  );
}