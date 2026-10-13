import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/i18n';

/**
 * 轻量上下文菜单（R12 / IX-4）。
 *
 * 面板内的标签行此前没有任何右键菜单（背景层 contextMenus 实现的是浏览器原生菜单，
 * 只作用于标签栏/页面/链接，不作用于侧边栏内的行）。
 *
 * 行为契约与 DialogShell 对齐：Esc 关闭、焦点恢复到触发元素、点击外部关闭、
 * 菜单项可键盘导航（↑/↓ 循环、Home/End 跳首尾）。背景 inert 由 DialogShell 的
 * 机制统一处理（本组件不入 modalStack，因为它不拦截 Tab 陷阱 —— 菜单是短暂浮层，
 * 抢陷焦点反而干扰；Tab 按「离开菜单」处理：关闭并把焦点归还触发元素）。
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
  /** 锚点打开时的位置：滚动/尺寸变化后按位移量平移菜单。 */
  const anchorOrigin = useRef<{ left: number; top: number } | null>(null);
  const [shift, setShift] = useState({ dx: 0, dy: 0 });

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
  // 此前写 34，每项多留 6px，项数多时菜单整体上移、离触发点越来越远。
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
      aria-label={t('更多操作')}
      className="modal-panel elev-3 fixed z-50 min-w-40 rounded-lg border border-gray-200 bg-surface py-1"
      style={style}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
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
