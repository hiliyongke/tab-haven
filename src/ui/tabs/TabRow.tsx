import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TabRecord } from '@/core/tab-types';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { StatusBadges } from '@/ui/common/StatusBadges';

/** 拖放数据键（标签 id）。 */
export const TAB_DRAG_MIME = 'application/x-tab-id';
/** 标签拖拽结束事件：让所有潜在目标清理自己的落点指示器。 */
export const TAB_DRAG_FINISHED_EVENT = 'tabhaven:tab-drag-finished';

function finishTabDrag() {
  window.dispatchEvent(new Event(TAB_DRAG_FINISHED_EVENT));
}

/**
 * 标签行：主按钮（切换/选择）+ 状态徽章 + 悬停操作（静音/固定/关闭）。
 *
 * 交互（行为规格）：
 *  - 普通模式：点击切换；悬停显示行操作；中键关闭；可拖拽（到固定区/文件夹）；
 *  - 选择模式：点击切换选中（shift 连选）、不激活；不响应悬停操作。
 */
export function TabRow({
  tab,
  duplicateCount,
  isActive,
  isSplitCompanion,
  selectionMode,
  selected,
  onActivate,
  onToggleSelect,
  onRangeSelect,
  onToggleMute,
  onTogglePin,
  onClose,
  onDuplicate,
  onDiscard,
  reorderEnabled,
  onReorder,
  onMoveTab,
  showUrl,
  autoScrollActive = true,
  closeOnMiddleClick = true,
  density = 'compact',
  showSplitBadges = true,
  indent,
  preview,
  isHighlighted,
  isSearchActive,
  onRequestPreview,
  rowActionsVisible = true,
}: {
  tab: TabRecord;
  duplicateCount: number;
  isActive: boolean;
  isSplitCompanion: boolean;
  selectionMode: boolean;
  selected: boolean;
  onActivate: (tabId: number) => void;
  onToggleSelect: (tabId: number) => void;
  onRangeSelect: (tabId: number) => void;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onClose: (tab: TabRecord) => void;
  /** 复制标签。 */
  onDuplicate?: (tab: TabRecord) => void;
  /** 冻结（休眠）标签。 */
  onDiscard?: (tab: TabRecord) => void;
  /** 拖拽重排：源标签 id、目标标签 id、插到目标之前(false)还是之后(true)。 */
  reorderEnabled?: boolean;
  onReorder?: (sourceId: number, targetId: number, placeAfter: boolean) => void;
  /** 键盘重排（Alt+↑/↓）：把标签向相邻位置移动。 */
  onMoveTab?: (tabId: number, direction: -1 | 1) => void;
  /** 标题下方显示完整网址。 */
  showUrl?: boolean;
  /** 激活标签自动滚入可视区。 */
  autoScrollActive?: boolean;
  /** 中键点击关闭标签。 */
  closeOnMiddleClick?: boolean;
  /** 列表密度：compact 紧凑 / cozy 宽松。 */
  density?: 'compact' | 'cozy';
  /** 是否显示分屏「拆 / 伴」标记。 */
  showSplitBadges?: boolean;
  /** 来源树模式下的缩进层级（0 为根）。 */
  indent?: number;
  /** 悬停预览缩略图 dataURL（captureVisibleTab 缓存）。 */
  preview?: string;
  /** 是否被浏览器高亮（多选选区）。 */
  isHighlighted?: boolean;
  /** 是否为当前搜索结果。 */
  isSearchActive?: boolean;
  /** 用户悬停时按需请求预览。 */
  onRequestPreview?: (tab: TabRecord) => void;
  /** 是否显示行尾快捷操作。 */
  rowActionsVisible?: boolean;
}) {
  const { t } = useTranslation();
  const handleMainClick = (event: React.MouseEvent) => {
    if (selectionMode) {
      if (event.shiftKey) onRangeSelect(tab.id);
      else onToggleSelect(tab.id);
    } else {
      onActivate(tab.id);
    }
  };

  const rowRef = useRef<HTMLLIElement>(null);
  const [dropPos, setDropPos] = useState<null | 'before' | 'after'>(null);

  // 拖拽重排：仅接受来自其他标签拖放（TAB_DRAG_MIME），按上/下半区判定插到前/后。
  const handleDragOver = (event: React.DragEvent) => {
    if (!reorderEnabled || !onReorder) return;
    if (!event.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setDropPos(event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
  };
  const handleDragLeave = () => setDropPos(null);
  const handleDrop = (event: React.DragEvent) => {
    if (!reorderEnabled || !onReorder) return;
    if (!event.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
    event.preventDefault();
    const sourceId = Number(event.dataTransfer.getData(TAB_DRAG_MIME));
    if (sourceId && sourceId !== tab.id) onReorder(sourceId, tab.id, dropPos === 'after');
    setDropPos(null);
  };

  // 当前激活标签变化时，将其滚动进可视区（仅在不完全可见时滚动）。
  useEffect(() => {
    if (autoScrollActive && isActive && rowRef.current) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
  }, [isActive, autoScrollActive]);

  useEffect(() => {
    if (isSearchActive && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [isSearchActive]);

  useEffect(() => {
    const clearDropIndicator = () => setDropPos(null);
    window.addEventListener(TAB_DRAG_FINISHED_EVENT, clearDropIndicator);
    return () => window.removeEventListener(TAB_DRAG_FINISHED_EVENT, clearDropIndicator);
  }, []);

  return (
    <li
      ref={rowRef}
      role="listitem"
      className={
        'group relative flex items-center gap-1 rounded px-1.5 py-[2px] text-xs transition-base hover:bg-gray-50 row-item' +
        (density === 'cozy' ? ' density-cozy' : '') +
        (isActive ? ' is-active' : '') +
        (tab.audible && !tab.muted ? ' is-media-playing' : '') +
        (isSearchActive ? ' is-search-active' : '') +
        (isSplitCompanion ? ' bg-accent-50/60' : '') +
        (tab.discarded ? ' opacity-60' : '') +
        (selected ? ' is-selected ring-1 ring-accent-300' : '') +
        (isHighlighted ? ' is-highlighted ring-1 ring-warn-600' : '') +
        (dropPos === 'before' ? ' drop-before' : dropPos === 'after' ? ' drop-after' : '') +
        (indent ? ' has-indent' : '')
      }
      style={indent ? { paddingLeft: `${Math.min(8 + indent * 16, 48)}px` } : undefined}
      onAuxClick={(event) => {
        if (event.button === 1 && !selectionMode && closeOnMiddleClick) onClose(tab);
      }}
      draggable={!selectionMode}
      onDragStart={(event) => {
        if (selectionMode) return;
        event.dataTransfer.setData(TAB_DRAG_MIME, String(tab.id));
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={finishTabDrag}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseEnter={() => onRequestPreview?.(tab)}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={handleMainClick}
        title={selectionMode ? undefined : t('tabs.switchTo', { title: tab.title || '' })}
        onKeyDown={(event) => {
          // 键盘重排：Alt+↑/↓ 移动当前行（仅重排启用且非选择模式时）
          if (!selectionMode && reorderEnabled && onMoveTab && event.altKey) {
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onMoveTab(tab.id, -1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              onMoveTab(tab.id, 1);
            }
          }
        }}
      >
        {!selectionMode && (
          <span
            className="drag-grip inline-flex shrink-0 items-center"
            aria-hidden="true"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon d={Icons.grip} className="h-3.5 w-3.5" />
          </span>
        )}
        {selectionMode ? (
          <span
            className={
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-2xs' +
              (selected ? ' border-accent-500 bg-accent-500 text-on-accent' : ' border-gray-300')
            }
            aria-hidden="true"
          >
            {selected ? '✓' : ''}
          </span>
        ) : (
          <Favicon src={tab.favIconUrl} title={tab.title || ''} size={16} />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate title-text">{tab.title || t('tabs.untitled')}</span>
          {showUrl && tab.url && (
            <span className="tab-url truncate text-2xs leading-tight text-gray-500">{tab.url}</span>
          )}
        </span>
        {tab.pinned && (
          <Icon
            d={Icons.pin}
            className="h-3 w-3 shrink-0 text-accent-500"
            aria-label={t('tabs.pinned')}
          />
        )}
      </button>

      {!selectionMode && (
        <>
          <StatusBadges
            tab={tab}
            duplicateCount={duplicateCount}
            isSplitCompanion={isSplitCompanion}
            showSplitBadges={showSplitBadges}
          />
          {rowActionsVisible && (
            <span className="flex shrink-0 items-center gap-0.5 w-0 overflow-hidden opacity-0 transition-all duration-150 group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100">
              {(tab.audible || tab.muted) && (
              <button
                type="button"
                className="row-action"
                title={tab.muted ? t('tabs.unmute') : t('tabs.mute')}
                aria-label={tab.muted ? t('tabs.unmute') : t('tabs.mute')}
                onClick={() => onToggleMute(tab)}
              >
                <Icon d={tab.muted ? Icons.muted : Icons.mute} className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              className="row-action"
              title={tab.pinned ? t('tabs.unpin') : t('tabs.pin')}
              aria-label={tab.pinned ? t('tabs.unpin') : t('tabs.pin')}
              onClick={() => onTogglePin(tab)}
            >
              <Icon d={Icons.pin} className={'h-3.5 w-3.5' + (tab.pinned ? ' text-accent-500' : '')} />
            </button>
            {onDuplicate && (
              <button
                type="button"
                className="row-action"
                title={t('tabs.duplicate')}
                aria-label={t('tabs.duplicate')}
                onClick={() => onDuplicate(tab)}
              >
                <Icon d={Icons.copy} className="h-3.5 w-3.5" />
              </button>
            )}
            {onDiscard && !tab.discarded && !tab.active && (
              <button
                type="button"
                className="row-action"
                title={t('tabs.discard')}
                aria-label={t('tabs.discard')}
                onClick={() => onDiscard(tab)}
              >
                <Icon d={Icons.snowflake} className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" className="row-action" title={t('tabs.closeTab')} aria-label={t('tabs.closeTab')} onClick={() => onClose(tab)}>
              <Icon d={Icons.close} className="h-3.5 w-3.5" />
            </button>
            </span>
          )}
        </>
      )}
      {preview && (
        <div className="pointer-events-none absolute left-full top-0 z-30 ml-2 hidden w-48 rounded border border-gray-200 bg-surface p-1 shadow-lg group-hover:block">
          <img src={preview} alt="preview" className="h-32 w-full rounded object-cover" />
        </div>
      )}
    </li>
  );
}
