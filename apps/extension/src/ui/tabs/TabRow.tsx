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
import type { Density } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowItem } from '@/ui/common/RowItem';
import { ContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';
import { StatusBadges } from '@/ui/common/StatusBadges';
import { useUndoStore } from '@/stores/undoStore';
import { writeClipboardText } from '@/platform/clipboard';
import { tabRowIdProps } from '@/ui/domContract';
import { TabRowActions } from '@/ui/tabs/TabRowActions';
import { useTabRowSortable } from '@/ui/tabs/useTabRowSortable';

/**
 * 标签行：拖拽 / 预览 / Alt+↑↓ 重排等容器逻辑；视觉壳复用通用 RowItem。
 * 拖拽由全局 dnd-kit 管理：列表内排序走 useSortable，跨容器投放由全局 onDragEnd 分派。
 *
 * 本文件只保留**行内容与交互**（滚动、菜单、复制、键盘重排）；dnd-kit 适配在
 * `useTabRowSortable`、行尾操作组在 `TabRowActions` —— 原 413 行里三者混排，
 * 改一个按钮的可见条件要在拖拽与菜单逻辑之间翻找。
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
  density?: Density;
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

  const rowContainer = useTabRowSortable({
    tabId: tab.id,
    containerKey,
    reorderEnabled: reorderEnabled !== false,
    title: tab.title || '',
    url: tab.url,
    menuOpen: menu !== null
  });

  // 行内派生元素一律 memo 化：它们作为 props 下传给 RowItem，每次新建对象
  // 都会击穿其 memo（详见 RowItem 注释）。
  const tabActions = useMemo(
    () => (
      <TabRowActions
        tab={tab}
        rowActionsVisible={rowActionsVisible}
        onToggleMute={onToggleMute}
        onTogglePin={onTogglePin}
        onDuplicate={onDuplicate}
        onDiscard={onDiscard}
        onClose={onClose}
      />
    ),
    [tab, onToggleMute, onTogglePin, onDuplicate, onDiscard, onClose, rowActionsVisible]
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
