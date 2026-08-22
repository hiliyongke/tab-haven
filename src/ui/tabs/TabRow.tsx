import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import type { TabRecord } from '@/core/tab-types';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowItem } from '@/ui/common/RowItem';
import { StatusBadges } from '@/ui/common/StatusBadges';
import { DragType } from '@/ui/dnd/types';

/**
 * 标签行：拖拽 / 预览 / Alt+↑↓ 重排等容器逻辑；视觉壳复用通用 RowItem。
 * 拖拽全部由全局 dnd-kit 管理（listeners 接入 RowItem 内部 div）：
 *  - 列表内排序：useSortable（整行拖动，受 tabOrderSync 设置控制，由 App 层决定是否生效）；
 *  - 跨容器投放（拖到固定空间/文件夹/永久固定区）：DragOverlay + 全局 onDragEnd 分派。
 */
export function TabRow({
  tab,
  duplicateCount,
  isActive,
  isSplitCompanion,
  onActivate,
  onToggleMute,
  onTogglePin,
  onClose,
  onDuplicate,
  onDiscard,
  reorderEnabled,
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
  containerKey
}: {
  tab: TabRecord;
  duplicateCount: number;
  isActive: boolean;
  isSplitCompanion: boolean;
  onActivate: (tabId: number) => void;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onClose: (tab: TabRecord) => void;
  /** 复制标签。 */
  onDuplicate?: (tab: TabRecord) => void;
  /** 冻结（休眠）标签。 */
  onDiscard?: (tab: TabRecord) => void;
  /** 是否启用排序（Alt+↑↓ 键盘重排）。 */
  reorderEnabled?: boolean;
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
  /** 所属容器 key（section key），供全局拖拽判断同容器排序。 */
  containerKey: string;
}) {
  const { t } = useTranslation();

  const liRef = useRef<HTMLLIElement | null>(null);

  // 排序使用 dnd-kit：始终可拖（跨容器拖到固定空间不受排序开关影响），
  // 列表内排序是否生效由 App 层按 tabOrderSync 设置控制。
  const sortable = useSortable({
    id: tab.id,
    data: {
      type: DragType.Tab,
      tabId: tab.id,
      containerKey,
      title: tab.title || '',
      favIconUrl: tab.favIconUrl
    }
  });

  // 当前激活标签变化时，将其滚动进可视区（仅在不完全可见时滚动）。
  useEffect(() => {
    if (autoScrollActive && isActive && liRef.current) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      liRef.current.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
  }, [isActive, autoScrollActive]);

  useEffect(() => {
    if (isSearchActive && liRef.current) {
      liRef.current.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [isSearchActive]);

  const tabActions = rowActionsVisible ? (
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
  ) : null;

  return (
    <li ref={liRef}>
      <RowItem
        faviconSrc={tab.favIconUrl}
        faviconTitle={tab.title || ''}
        isActive={isActive}
        isMediaPlaying={tab.audible && !tab.muted}
        isDiscarded={tab.discarded}
        isSplitCompanion={isSplitCompanion}
        isHighlighted={isHighlighted}
        isSearchActive={isSearchActive}
        density={density}
        indent={indent}
        onClick={() => onActivate(tab.id)}
        onAuxClick={(event) => {
          if (event.button === 1 && closeOnMiddleClick) onClose(tab);
        }}
        onMouseEnter={() => onRequestPreview?.(tab)}
        onKeyDown={(event) => {
          if (reorderEnabled && onMoveTab && event.altKey) {
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onMoveTab(tab.id, -1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              onMoveTab(tab.id, 1);
            }
          }
        }}
        buttonTitle={t('tabs.switchTo', { title: tab.title || '' })}
        title={tab.title || t('tabs.untitled')}
        secondary={
          showUrl && tab.url ? (
            <span className="tab-url truncate text-2xs leading-tight text-gray-500">{tab.url}</span>
          ) : null
        }
        trailing={
          tab.pinned ? (
            <Icon
              d={Icons.pin}
              className="h-3 w-3 shrink-0 text-accent-500"
              aria-label={t('tabs.pinned')}
            />
          ) : null
        }
        badges={
          <StatusBadges
            tab={tab}
            duplicateCount={duplicateCount}
            isSplitCompanion={isSplitCompanion}
            showSplitBadges={showSplitBadges}
          />
        }
        actions={tabActions}
        preview={preview}
        container={{
          ref: sortable.setNodeRef,
          listeners: sortable.listeners,
          style: {
            transform: sortable.transform
              ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
              : undefined,
            transition: sortable.transition
          },
          className: sortable.isDragging ? 'is-sorting' : undefined
        }}
      />
    </li>
  );
}