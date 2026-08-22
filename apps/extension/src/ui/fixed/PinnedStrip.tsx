import { useMemo, useRef } from 'react';
import { useTranslation } from '@/i18n';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import type { PersistentPin } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { PINNED_STRIP_DROPPABLE } from '@/ui/dnd/types';
import {
  SortablePinnedTile,
  makePinMiddleClickHandler,
  buildPinRuntimeIndex,
  CLOSED_PIN_RUNTIME
} from '@/ui/tabs/SortablePinnedTile';

/**
 * 顶部常驻磁贴区：
 * 单击切换/重新打开；中键仅关闭页面、入口保留；拖标签到该区域固定。
 * 视觉语言：pinned-strip 磁贴（active 底部绿条、
 * closed 降透明度、audible 绿点、discarded 灰化、split 角标）。
 * 拖拽排序使用全局 dnd-kit（SortableContext 挂在外层 DndContext 下）。
 */
export function PinnedStrip() {
  const { t } = useTranslation();
  const pins = useDataStore((state) => state.pins);
  const openPin = useDataStore((state) => state.openPin);
  const removePin = useDataStore((state) => state.removePin);
  const closeTabs = useTabStore((state) => state.closeTabs);
  const tabs = useTabStore((state) => state.tabs);
  const notify = useUndoStore((state) => state.notify);
  /** 磁贴网格内滚区的底部渐隐（只在真的溢出、且未滚到底时才显示）。 */
  const pinGridRef = useRef<HTMLDivElement>(null);
  useScrollFade(pinGridRef, pins.length);
  const { isOver, setNodeRef } = useDroppable({
    id: PINNED_STRIP_DROPPABLE,
    data: { type: 'pinned-strip' }
  });

  // 一次建索引取代「每个磁贴各扫一遍全量标签」。
  // 注意 hook 必须在早退之前调用：pins 为空时组件仍要返回 null，但 hooks 顺序不能变。
  const runtimeIndex = useMemo(() => buildPinRuntimeIndex(tabs), [tabs]);
  // SortableContext items 必须 memo（同 FolderRow/SectionList 约定）：
  // 内联新数组会让 context value 每轮变更，全部磁贴强制重渲染。
  // 注意 hook 必须在早退之前调用。
  const pinIds = useMemo(() => pins.map((pin) => pin.id), [pins]);

  if (pins.length === 0) return null;

  const handleMiddleClick = makePinMiddleClickHandler(closeTabs);
  // 同一动作（取消固定）在标签行叫「取消固定」，这里曾叫「从磁贴条移除」。
  const unpinTitle = t('取消固定');

  return (
    <SortableContext items={pinIds} strategy={rectSortingStrategy}>
      <section
        ref={setNodeRef}
        className={'pinned-strip' + (isOver ? ' is-drop-target' : '')}
        aria-label={t('常驻磁贴')}
        data-drop-label={t('拖到磁贴条固定')}
      >
        {/* .pinned-grid 是横向留白的唯一来源（左右各 8px）：没有这一层，
            磁贴会贴死在 x=0，与搜索栏图标 / 分区头色条 / 行内 favicon 的 8px 竖线错开。
            scroll-fade 必须配 useScrollFade：只加 class 时底部 12px 渐隐常驻，
            会盖住第二行磁贴的下半截（看起来像「被遮住」）。 */}
        <div ref={pinGridRef} className="pinned-grid scroll-fade">
          {pins.map((pin: PersistentPin) => {
            const runtime = runtimeIndex.get(pin.identity) ?? CLOSED_PIN_RUNTIME;
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
                // 移除磁贴必须有明确反馈（与 addPin 的「已固定标签」对等）：
                // 磁贴从条上消失虽然也是反馈，但用户分不清是移除成功还是被挤走。
                onUnpin={() =>
                  void Promise.resolve(removePin(pin)).then(() => notify(t('已取消固定')))
                }
                unpinTitle={unpinTitle}
              />
            );
          })}
        </div>
      </section>
    </SortableContext>
  );
}
