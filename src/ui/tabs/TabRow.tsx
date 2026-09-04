import { memo, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import type { TabRecord } from '@/core/tab-types';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowActions } from '@/ui/common/RowActions';
import { RowItem } from '@/ui/common/RowItem';
import { StatusBadges } from '@/ui/common/StatusBadges';
import { DragType } from '@/ui/dnd/types';

/**
 * 标签行：拖拽 / 预览 / Alt+↑↓ 重排等容器逻辑；视觉壳复用通用 RowItem。
 * 拖拽由全局 dnd-kit 管理：列表内排序走 useSortable，跨容器投放由全局 onDragEnd 分派。
 *
 * memo 化的前提：App 层已把回调收敛进 sectionCallbacks 的 useMemo，且 tab 引用由 store 保证稳定。
 */
export const TabRow = memo(function TabRow({
  tab,
  duplicateCount,
  isActive,
  isSplitCompanion,
  splitGroupRole,
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
  density = 'cozy',
  showSplitBadges = true,
  indent,
  isHighlighted,
  isSearchActive,
  rowActionsVisible = true,
  noCache = false,
  containerKey
}: {
  tab: TabRecord;
  duplicateCount: number;
  isActive: boolean;
  isSplitCompanion: boolean;
  /** 分屏组括弧角色（组首/组中/组尾），视觉上连成左括号。 */
  splitGroupRole?: 'first' | 'middle' | 'last';
  onActivate: (tabId: number) => void;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onClose: (tab: TabRecord) => void;
  onDuplicate?: (tab: TabRecord) => void;
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
  /** 是否被浏览器高亮（多选选区）。 */
  isHighlighted?: boolean;
  /** 是否为当前搜索结果。 */
  isSearchActive?: boolean;
  /** 是否显示行尾快捷操作。 */
  rowActionsVisible?: boolean;
  /** 是否命中「开发者禁缓存」规则（侧边栏角标提示用）。 */
  noCache?: boolean;
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

  // 键盘拖拽与指针拖拽分流：键盘监听挂主按钮（KeyboardSensor 要求 keydown 目标即 activator），
  // 指针监听挂整行（PointerSensor 无目标限制），两者不会为同一事件重复激活。
  const { onKeyDown: sortableKeyDown, ...sortablePointerListeners } = sortable.listeners ?? {};

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

  const tabActions = (
    <RowActions forceVisible={rowActionsVisible}>
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
      <button
        type="button"
        className="row-action is-danger"
        title={t('tabs.closeTab')}
        aria-label={t('tabs.closeTab')}
        onClick={() => onClose(tab)}
      >
        <Icon d={Icons.close} className="h-3.5 w-3.5" />
      </button>
    </RowActions>
  );

  return (
    <li ref={liRef} data-tabs-tab-id={tab.id}>
      <RowItem
        faviconSrc={tab.favIconUrl}
        faviconTitle={tab.title || ''}
        isActive={isActive}
        isMediaPlaying={tab.audible && !tab.muted}
        isDiscarded={tab.discarded}
        isSplitCompanion={isSplitCompanion}
        splitGroupRole={splitGroupRole}
        isHighlighted={isHighlighted}
        isSearchActive={isSearchActive}
        density={density}
        indent={indent}
        onClick={() => onActivate(tab.id)}
        onAuxClick={(event) => {
          if (event.button === 1 && closeOnMiddleClick) onClose(tab);
        }}
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
            noCache={noCache}
          />
        }
        actions={tabActions}
        container={{
          ref: sortable.setNodeRef,
          listeners: sortablePointerListeners,
          activatorRef: sortable.setActivatorNodeRef,
          buttonAttributes: sortable.attributes,
          buttonListeners: sortableKeyDown
            ? {
                onKeyDown: sortableKeyDown as (event: ReactKeyboardEvent<HTMLButtonElement>) => void
              }
            : undefined,
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
});
