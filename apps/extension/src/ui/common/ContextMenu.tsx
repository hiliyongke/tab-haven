// 别名导入：MouseEvent 会遮蔽 DOM 同名类型，令 addEventListener 处理器类型不兼容。
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/i18n';
import { useModalA11y } from '@/ui/dialog/Dialog';

/**
 * 轻量上下文菜单（面板内标签行右键；浏览器原生 contextMenus 菜单只作用于标签栏/页面/链接）。
 * 契约同 DialogShell：Esc 关闭、焦点恢复触发元素、点外部关闭、↑/↓ 循环 + Home/End 导航。
 * 以 `trapFocus: false` 入 modalStack 复用「全局快捷键不叠浮层 / 背景惰性化」，但不抢 Tab
 * 陷阱（Tab 视为离开）；Esc/Tab 由本组件自己处理，避免与弹窗栈各关一次。
 */

export interface ContextMenuItem {
  /** 稳定标识（兼作 React key）：用数组下标会在条件增减时错位复用焦点与 disabled 态。 */
  id: string;
  label: string;
  onSelect: () => void;
  /** 危险项（关闭等）用危险色。 */
  danger?: boolean;
  disabled?: boolean;
}

const FOCUSABLE = 'button:not([disabled])';

/** 行级右键菜单开关状态（各实体共用）。抽出来保证 close 引用稳定 —— 内联箭头每次渲染
 *  都是新引用，会让 ContextMenu 依赖 onClose 的 effect 反复解绑重挂。 */
export function useRowContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const open = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    // 键盘触发时 clientX/clientY 恒为 0，改用元素下沿定位让菜单贴着被操作的行。
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ x: rect.left, y: rect.bottom });
      return;
    }
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  return { menu, open, close };
}

export function ContextMenu({
  x,
  y,
  items,
  anchorRef,
  onClose
}: {
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  /** 锚点元素（通常是触发菜单的那一行）：菜单随它平移，它消失则菜单关闭。 */
  anchorRef?: { current: HTMLElement | null };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // 必须在「打开即聚焦首项」effect 之前调用：那 effect 靠挂载时 activeElement 记住触发元素，
  // 焦点先被移走会让焦点恢复指向即将卸载的菜单项。trapFocus=false：不抢 Tab、不接管 Esc。
  useModalA11y(ref, onClose, false);
  /** 锚点打开时的位置：滚动/尺寸变化后按位移量平移菜单。 */
  const anchorOrigin = useRef<{ left: number; top: number } | null>(null);
  const [shift, setShift] = useState({ dx: 0, dy: 0 });
  /** 挂载后实测贴边校正：估算宽高在 200% 缩放时偏小会把菜单底部推出视口，挂载后量真实尺寸
   *  再收一次边（只在打开瞬间，不闪烁）。 */
  const [fitted, setFitted] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    // 基准取意图位置（x/y + 位移）而非 rect：style 是 fitted ?? style，用 rect 当基准会
    // 自引用，fitted 一旦命中就永远量不到新位置（滚动跟随失效）。
    const left = Math.min(x + shift.dx, Math.max(0, window.innerWidth - rect.width - 4));
    const top = Math.min(y + shift.dy, Math.max(0, window.innerHeight - rect.height - 8));
    setFitted({ left, top });
  }, [x, y, shift.dx, shift.dy, items.length]);

  // 打开即聚焦首项；触发元素须在聚焦前捕获（focus 之后 activeElement 已是菜单项）。
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    // 关闭时把焦点还给触发元素，否则 Esc 后焦点掉到 body，得从头 Tab 回来。
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  // 记录锚点打开时的位置：滚动/尺寸变化后按位移量平移菜单（见下方 follow）。
  useEffect(() => {
    const anchor = anchorRef?.current;
    anchorOrigin.current = anchor
      ? { left: anchor.getBoundingClientRect().left, top: anchor.getBoundingClientRect().top }
      : null;
  }, [anchorRef]);

  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const focusableItems = (): HTMLElement[] =>
      Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE));
    /** 循环移动焦点：到尾回到头、到头回到尾（role="menu" 的方向键契约）。 */
    const moveFocus = (delta: number): void => {
      const list = focusableItems();
      if (list.length === 0) return;
      const current = list.indexOf(document.activeElement as HTMLElement);
      list[(current + delta + list.length) % list.length]?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveFocus(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveFocus(-1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        focusableItems()[0]?.focus();
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        focusableItems().at(-1)?.focus();
        return;
      }
      // 不抢 Tab 陷阱：Tab 视为离开菜单，交还浏览器自然 Tab 顺序，不 preventDefault。
      if (event.key === 'Tab') onClose();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [onClose]);

  /** 跟随锚点：菜单是 portal 到 body 的固定定位浮层，滚动/尺寸变化后按锚点位移平移；
   *  锚点随行销毁时直接关闭（目标已不存在，留原地只会误导）。 */
  useEffect(() => {
    const origin = anchorOrigin.current;
    if (!origin) return;
    const follow = (): void => {
      const anchor = anchorRef?.current;
      if (!anchor || !anchor.isConnected) {
        onClose();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      setShift({ dx: rect.left - origin.left, dy: rect.top - origin.top });
    };
    // 捕获阶段：真正滚动的是内层列表容器，冒泡到 window 时才能一并收到。
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [anchorRef, onClose]);

  // 贴边收拢：未挂载时拿不到尺寸，先按估算宽高收边（实测需二次渲染会闪烁）。
  // ITEM_H = 28（px-3 py-1.5 + 16px 行高）；不按 34 估，否则项数多时菜单整体上移偏离触发点。
  const MENU_W = 180;
  const ITEM_H = 28;
  const maxLeft = Math.max(0, window.innerWidth - MENU_W);
  const maxTop = Math.max(0, window.innerHeight - items.length * ITEM_H - 12);
  const style: React.CSSProperties = {
    left: Math.min(x + shift.dx, maxLeft),
    top: Math.min(y + shift.dy, maxTop)
  };
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      aria-label={t('更多操作')}
      className="modal-panel modal-surface modal-surface--menu fixed z-50 min-w-40 py-1"
      style={fitted ?? style}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          /* menuitem 交给容器 roving：原生可聚焦会让 Tab 在项间移动，而 role="menu" 约定一个 Tab 进出。 */
          tabIndex={-1}
          disabled={item.disabled}
          /* `.menu-item`：hover/focus 底色与焦点环的唯一口径。用 focus 而非 focus-visible ——
             程序化 focus() 打开首项时 Chrome 的 :focus-visible 启发式不命中，首项会无焦点指示。 */
          className={`menu-item block w-full truncate px-3 py-1.5 text-left text-xs transition-colors disabled:cursor-default disabled:opacity-50 ${
            item.danger ? 'is-danger text-red-600' : 'text-gray-700'
          }`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
