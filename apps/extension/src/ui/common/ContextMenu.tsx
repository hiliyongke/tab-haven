// 用别名导入：直接叫 MouseEvent 会遮蔽 DOM 的 MouseEvent，令下方
// addEventListener 的处理器类型与 Event 不兼容。
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
 * 轻量上下文菜单。
 *
 * 覆盖面板内标签行的右键菜单（背景层 contextMenus 实现的是浏览器原生菜单，
 * 只作用于标签栏/页面/链接，不作用于侧边栏内的行）。
 *
 * 行为契约与 DialogShell 对齐：Esc 关闭、焦点恢复到触发元素、点击外部关闭、
 * 菜单项可键盘导航（↑/↓ 循环、Home/End 跳首尾）。
 *
 * 以 `trapFocus: false` 入 modalStack：借用「isModalOpen() 为真 → 全局快捷键
 * （⌘K/⌘P/⌘J）不再叠加第二层浮层」与「背景惰性化」两件事，但仍不抢 Tab 陷阱
 * —— 菜单是短暂浮层，Tab 按「离开菜单」处理（关闭并把焦点归还触发元素）。
 * Esc / Tab 由本组件自己处理，避免同一次按键被弹窗栈与菜单各关一次。
 */

export interface ContextMenuItem {
  /**
   * 稳定标识（同时用作 React key）。
   *
   * 用数组下标做 key 会让菜单项在条件增减时错位复用（焦点与 disabled 态跟着
   * 错位），与 CommandPalette 的 `key={cmd.id}` 同口径。
   */
  id: string;
  label: string;
  onSelect: () => void;
  /** 危险项（关闭等）用危险色。 */
  danger?: boolean;
  disabled?: boolean;
}

const FOCUSABLE = 'button:not([disabled])';

/**
 * 行级右键菜单的开关状态（各实体共用：标签行 / 文件夹 / 固定条目 / 快照 / 磁贴）。
 *
 * 抽出来一是避免每个组件各写一份 state + preventDefault，二是保证 close 回调稳定
 * —— ContextMenu 的 effect 依赖 onClose，内联箭头每次渲染都是新引用，会让监听
 * 反复解绑重挂。
 */
export function useRowContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const open = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
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
  // 必须在「打开即聚焦首项」的 effect 之前调用：那个 effect 靠挂载时的
  // activeElement 记住触发元素，焦点若先被移走，弹窗栈的焦点恢复会指向菜单项
  // （而它马上就要被卸载）。trapFocus=false：不抢 Tab 陷阱、不接管 Esc。
  useModalA11y(ref, onClose, false);
  /** 锚点打开时的位置：滚动/尺寸变化后按位移量平移菜单。 */
  const anchorOrigin = useRef<{ left: number; top: number } | null>(null);
  const [shift, setShift] = useState({ dx: 0, dy: 0 });
  /**
   * 挂载后的**实测**贴边校正。
   *
   * 上面用 MENU_W/ITEM_H 估算只是打开前的一次近似：200% 文本缩放时每项实际
   * 高度约 56px 而估算按 28px，maxTop 算大 → 菜单底部被推出视口、末尾项点不到。
   * 挂载后量一次真实尺寸再收一次边（只发生在打开瞬间，不产生可见闪烁）。
   */
  const [fitted, setFitted] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    // 基准取**意图位置**（x/y + 跟随位移）而不是 rect.left/top：
    // rect 是上一次 style 的结果，而 style 又是 fitted ?? style —— 用 rect 当基准
    // 就成了自引用，fitted 一旦命中就永远量不到新位置（滚动跟随随之失效）。
    const left = Math.min(x + shift.dx, Math.max(0, window.innerWidth - rect.width - 4));
    const top = Math.min(y + shift.dy, Math.max(0, window.innerHeight - rect.height - 8));
    setFitted({ left, top });
  }, [x, y, shift.dx, shift.dy, items.length]);

  // 打开即聚焦首项：键盘用户无需再用 Tab 找菜单。
  // 触发元素必须在聚焦之前捕获 —— focus 之后 activeElement 已是菜单项。
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    // 关闭（Esc / 选中 / Tab / 点外部）都要把焦点还给触发元素：否则键盘用户
    // 按 Esc 后焦点掉到 body，得从头 Tab 一遍才能回到刚才那一行。
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
      // 不入 modalStack 即不抢 Tab 陷阱：Tab 视为离开菜单（归还焦点交还给浏览器
      // 的自然 Tab 顺序），不 preventDefault。
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

  /**
   * 跟随锚点：菜单是 portal 到 body 的固定定位浮层，列表滚动或窗口尺寸变化后
   * 原地不动就会脱离触发它的那一行（浮在无关内容上）。这里按锚点的位移量
   * 平移菜单；锚点随行一起被销毁时（如该行被关闭）直接关闭菜单 —— 菜单指向的
   * 目标已经不存在，留在原地只会误导。
   */
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

  // 贴边收拢：菜单不超出视口（侧边栏宽度有限，右键常在右侧边缘触发）。
  // 估算宽高而非实测：菜单未挂载时拿不到尺寸，实测需二次渲染（闪烁）。
  // ITEM_H = 28：菜单项 px-3 py-1.5 + text-xs(16px 行高) = 12+16 = 28px。
  // 不能按 34 估：每项多留 6px，项数多时菜单整体上移、离触发点越来越远。
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
      className="modal-panel elev-3 fixed z-50 min-w-40 rounded-lg border border-gray-200 bg-surface py-1"
      style={fitted ?? style}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          /* menuitem 交给容器接管焦点（roving）：留着原生可聚焦会让 Tab 在
             菜单项之间移动，而 role="menu" 的约定是一个 Tab 进出菜单。 */
          tabIndex={-1}
          disabled={item.disabled}
          /* focus: 而非仅 focus-visible：菜单由程序化 focus() 打开首项，此时
             Chrome 的 :focus-visible 启发式不命中（上一次交互是指针），焦点会落在
             首项却毫无指示 —— 直接按 Enter 会执行一个用户看不见的项。
             disabled:hover/disabled:focus 屏蔽：disabled 按钮仍匹配 :hover。 */
          className={`block w-full truncate px-3 py-1.5 text-left text-xs transition-colors hover:bg-gray-50 focus:bg-gray-50 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:focus:bg-transparent ${
            item.danger
              ? 'text-red-600 hover:bg-red-50 focus:bg-red-50 disabled:hover:bg-transparent'
              : 'text-gray-700'
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
