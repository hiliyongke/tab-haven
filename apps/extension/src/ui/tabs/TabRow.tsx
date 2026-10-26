import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { useTranslation } from '@/i18n';
import { useSortable } from '@dnd-kit/sortable';
import type { TabRecord } from '@/core/tab-types';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowActions } from '@/ui/common/RowActions';
import { RowItem } from '@/ui/common/RowItem';
import { ContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';
import { StatusBadges } from '@/ui/common/StatusBadges';
import { useUndoStore } from '@/stores/undoStore';
import { writeClipboardText } from '@/platform/clipboard';
import { DragType } from '@/ui/dnd/types';
import { tabRowIdProps } from '@/ui/domContract';

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
  autoScrollOnSearch = true,
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
  /** 中键点击关闭标签（固定空间入口保留，只关页面）。 */
  closeOnMiddleClick?: boolean;
  /** 列表密度：compact 紧凑 / cozy 宽松 / large 大字号。 */
  density?: 'compact' | 'cozy' | 'large';
  /** 是否显示分屏「拆 / 伴」标记。 */
  showSplitBadges?: boolean;
  /** 来源树模式下的缩进层级（0 为根）。 */
  indent?: number;
  /** 是否被浏览器高亮（多选选区）。 */
  isHighlighted?: boolean;
  /** 是否为当前搜索结果（仅高亮样式；滚动由 autoScrollOnSearch 控制）。 */
  isSearchActive?: boolean;
  /**
   * 搜索命中行自动 scrollIntoView（默认 true）。
   * 虚拟化分区必须传 false：那里的滚动由 VirtualRowList 按 index 承担。
   */
  autoScrollOnSearch?: boolean;
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
    // 关掉让位过渡：其余行会在 200ms 内持续位移，而碰撞检测读的是实时矩形，
    // 动画期间矩形一直在变，落点随之漂移 —— 表现为「松手前要停一下才准」。
    // 去掉过渡后元素瞬间到位，矩形立即稳定，落点与所见一致。
    transition: null,
    data: {
      type: DragType.Tab,
      tabId: tab.id,
      containerKey,
      // 行间排序是否可用（false = 超阈值强制虚拟化分区的行：UI 已提示
      // 「拖拽排序已暂停」，但行仍保留 draggable/droppable 以支持跨容器
      // 拖到固定空间）。拖放分发据此拦截 Tab→Tab 真实排序——否则出现
      // 「提示暂停、松手却真实重排」的行为矛盾。
      canReorder: reorderEnabled !== false,
      title: tab.title || '',
      // 拖拽跟随层要显示图标：带页面地址交给 Favicon 走浏览器通道，不再带图标地址。
      url: tab.url
    }
  });

  // 键盘拖拽与指针拖拽分流：键盘监听挂主按钮（KeyboardSensor 要求 keydown 目标即 activator），
  // 指针监听挂整行（PointerSensor 无目标限制），两者不会为同一事件重复激活。
  //
  // 必须 memo 化：解构 `sortable.listeners` 每次渲染都会产生全新对象，直接下传会让
  // RowItem 的 memo 100% 失效 —— 大列表父级重渲染时全部行都要走一遍 reconcile。
  const sortableKeyDown = sortable.listeners?.onKeyDown as
    ((event: ReactKeyboardEvent<HTMLButtonElement>) => void) | undefined;
  const sortablePointerListeners = useMemo(() => {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sortable.listeners ?? {})) {
      if (key !== 'onKeyDown') rest[key] = value;
    }
    return rest;
  }, [sortable.listeners]);
  const buttonListeners = useMemo(
    () => (sortableKeyDown ? { onKeyDown: sortableKeyDown } : undefined),
    [sortableKeyDown]
  );

  // 当前激活标签变化时，将其滚动进可视区（仅在不完全可见时滚动）。
  useEffect(() => {
    if (autoScrollActive && isActive && liRef.current) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      liRef.current.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
  }, [isActive, autoScrollActive]);

  /**
   * 搜索命中行滚入可视区。
   *
   * `isSearchActive` 只承担高亮样式，滚动另走 `autoScrollOnSearch`：虚拟化分区
   * 的滚动由 VirtualRowList 按 index 单点承担（行可能在渲染窗口外，本行的
   * scrollIntoView 压根不会挂载），两路并存时目标口径不同会互相抖动 ——
   * 故虚拟化分支显式传 false。
   */
  useEffect(() => {
    if (autoScrollOnSearch && isSearchActive && liRef.current) {
      liRef.current.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [isSearchActive, autoScrollOnSearch]);

  // 行内事件回调同样必须稳定：RowItem 是 memo 组件，内联箭头函数每次渲染
  // 都是新引用，浅比较必然失败 —— 任何 prop 变化（如 isSearchActive）都会让
  // 全部可见行多做一轮 reconcile，memo 收益被抵消。
  /**
   * 复制网址（R12）。
   * clipboard 在非安全上下文可能不可用：失败时降级为「选中提示」而非静默无反应。
   */
  const copyTabUrl = useCallback(
    async (target: TabRecord) => {
      const url = target.url ?? '';
      // 走 platform 唯一出口：ui 不直连浏览器 API（分层红线）。
      if (await writeClipboardText(url)) {
        useUndoStore.getState().notify(t('已复制网址'));
      } else {
        // 失败必须报错：与成功同文案会让用户以为已复制，粘贴时才发现剪贴板没变。
        useUndoStore.getState().notifyError(t('操作失败，请稍后重试'));
      }
    },
    [t]
  );

  /** 右键菜单：面板内标签行的上下文菜单。 */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);

  // 关闭回调必须稳定：ContextMenu 的 effect 依赖 onClose，内联箭头每次渲染都是
  // 新引用，会让监听反复解绑重挂（与本文件「行内回调必须稳定」的约定同因）。
  const closeMenu = useCallback(() => setMenu(null), []);

  const menuItems = useMemo<ContextMenuItem[]>(
    () => [
      { id: 'copy-url', label: t('复制网址'), onSelect: () => void copyTabUrl(tab) },
      {
        id: 'toggle-pin',
        // context: 'action' —— 与分区标题「固定标签」同文但词性不同（动作 vs 名词），
        // 哈希词典里同文共用一个译文，靠 context 拆出「Pin this tab」而不动中文原文。
        label: tab.pinned ? t('取消固定') : t('固定到浏览器标签栏（置顶）'),
        onSelect: () => onTogglePin(tab)
      },
      ...(onDiscard && !tab.discarded && !tab.active
        ? [{ id: 'discard', label: t('休眠标签（释放内存）'), onSelect: () => onDiscard(tab) }]
        : []),
      ...(onDuplicate
        ? [{ id: 'duplicate', label: t('打开副本'), onSelect: () => onDuplicate(tab) }]
        : []),
      { id: 'close', label: t('关闭标签'), onSelect: () => onClose(tab), danger: true }
    ],
    [tab, t, onTogglePin, onDiscard, onDuplicate, onClose, copyTabUrl]
  );

  const handleActivate = useCallback(() => onActivate(tab.id), [onActivate, tab.id]);
  const handleAuxClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.button === 1 && closeOnMiddleClick) onClose(tab);
    },
    [closeOnMiddleClick, onClose, tab]
  );
  const handleRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (reorderEnabled && onMoveTab && event.altKey) {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          onMoveTab(tab.id, -1);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          onMoveTab(tab.id, 1);
        }
      }
      // 键盘等价入口：右键菜单不能只有鼠标一条路 —— 部分平台/键盘布局与远程
      // 桌面下 Shift+F10 不派发 contextmenu 事件，行聚焦时也要能打开菜单。
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const rect = liRef.current?.getBoundingClientRect();
        setMenu({ x: rect ? rect.right - 12 : 0, y: rect ? rect.top + 8 : 0 });
      }
    },
    [reorderEnabled, onMoveTab, tab.id]
  );

  // 行内派生元素一律 memo 化：它们作为 props 下传给 RowItem，每次新建对象
  // 都会击穿其 memo（详见 RowItem 注释）。
  const tabActions = useMemo(
    () => (
      <RowActions forceVisible={rowActionsVisible}>
        {(tab.audible || tab.muted) && (
          <button
            type="button"
            className="row-action"
            title={tab.muted ? t('取消静音') : t('静音')}
            aria-label={tab.muted ? t('取消静音') : t('静音')}
            onClick={() => onToggleMute(tab)}
          >
            <Icon d={tab.muted ? Icons.volumeOff : Icons.volumeOn} className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="row-action"
          title={tab.pinned ? t('取消固定') : t('固定到浏览器标签栏（置顶）')}
          aria-label={tab.pinned ? t('取消固定') : t('固定到浏览器标签栏（置顶）')}
          onClick={() => onTogglePin(tab)}
        >
          <Icon d={Icons.pin} className={'h-3.5 w-3.5' + (tab.pinned ? ' text-accent-500' : '')} />
        </button>
        {onDuplicate && (
          <button
            type="button"
            className="row-action"
            title={t('打开副本')}
            aria-label={t('打开副本')}
            onClick={() => onDuplicate(tab)}
          >
            <Icon d={Icons.copy} className="h-3.5 w-3.5" />
          </button>
        )}
        {onDiscard && !tab.discarded && !tab.active && (
          <button
            type="button"
            className="row-action"
            title={t('休眠标签（释放内存）')}
            aria-label={t('休眠标签（释放内存）')}
            onClick={() => onDiscard(tab)}
          >
            <Icon d={Icons.snowflake} className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="row-action is-danger"
          title={t('关闭标签')}
          aria-label={t('关闭标签')}
          onClick={() => onClose(tab)}
        >
          <Icon d={Icons.close} className="h-3.5 w-3.5" />
        </button>
      </RowActions>
    ),
    [tab, onToggleMute, onTogglePin, onDuplicate, onDiscard, onClose, t, rowActionsVisible]
  );

  const secondary = useMemo(
    () =>
      showUrl && tab.url ? (
        <span className="tab-url truncate text-2xs leading-tight text-gray-500">{tab.url}</span>
      ) : null,
    [showUrl, tab.url]
  );
  const trailing = useMemo(
    () =>
      /* 不用 <Icon aria-label>：Icon 的 props 只解构 { d, className, title }，
         aria-label 会被静默丢弃（图标是 aria-hidden）。改为 sr-only 文本承载语义，
         与 StatusBadges 同款口径。 */
      tab.pinned ? (
        <>
          <Icon d={Icons.pin} className="h-3 w-3 shrink-0 text-accent-500" />
          <span className="sr-only">{t('已固定')}</span>
        </>
      ) : null,
    [tab.pinned, t]
  );
  const badges = useMemo(
    () => (
      <StatusBadges
        tab={tab}
        duplicateCount={duplicateCount}
        isSplitCompanion={isSplitCompanion}
        showSplitBadges={showSplitBadges}
        noCache={noCache}
      />
    ),
    [tab, duplicateCount, isSplitCompanion, showSplitBadges, noCache]
  );

  // container 依赖 useSortable 的返回值：其内部对象每次渲染都是新引用，
  // 因此只取标量字段做依赖，让 container 在「排序状态未变」时保持稳定。
  const transformX = sortable.transform?.x;
  const transformY = sortable.transform?.y;
  const {
    transition: sortTransition,
    isDragging,
    setNodeRef,
    setActivatorNodeRef,
    attributes
  } = sortable;
  const rowContainer = useMemo(
    () => ({
      ref: setNodeRef,
      activatorRef: setActivatorNodeRef,
      // 主按钮是行内唯一的交互元素：菜单可弹出/已展开的状态挂在这里（读屏可播报），
      // 而不是挂在不参与交互的 li 上。
      buttonAttributes: {
        ...attributes,
        'aria-haspopup': 'menu',
        'aria-expanded': menu !== null
      },
      listeners: sortablePointerListeners,
      buttonListeners,
      style: {
        transform:
          transformX || transformY
            ? `translate3d(${transformX ?? 0}px, ${transformY ?? 0}px, 0)`
            : undefined,
        transition: sortTransition
      },
      className: isDragging ? 'is-sorting' : undefined
    }),
    [
      setNodeRef,
      setActivatorNodeRef,
      attributes,
      menu,
      sortablePointerListeners,
      buttonListeners,
      transformX,
      transformY,
      sortTransition,
      isDragging
    ]
  );

  return (
    <li ref={liRef} {...tabRowIdProps(tab.id)} onContextMenu={handleContextMenu}>
      <RowItem
        faviconPageUrl={tab.url}
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
        onClick={handleActivate}
        onAuxClick={handleAuxClick}
        onKeyDown={handleRowKeyDown}
        buttonTitle={t('切换到：{{title}}', { title: tab.title || '' })}
        title={tab.title || t('无标题标签')}
        secondary={secondary}
        trailing={trailing}
        badges={badges}
        actions={tabActions}
        container={rowContainer}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          anchorRef={liRef}
          onClose={closeMenu}
        />
      )}
    </li>
  );
});
