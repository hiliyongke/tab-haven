import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * 轻量上下文菜单（R12 / IX-4）。
 *
 * 面板内的标签行此前没有任何右键菜单（背景层 contextMenus 实现的是浏览器原生菜单，
 * 只作用于标签栏/页面/链接，不作用于侧边栏内的行）。
 *
 * 行为契约与 DialogShell 对齐：Esc 关闭、焦点恢复到触发元素、点击外部关闭、
 * 菜单项可键盘导航。背景 inert 由 DialogShell 的机制统一处理（本组件不入 modalStack，
 * 因为它不拦截 Tab 陷阱 —— 菜单是短暂浮层，抢陷焦点反而干扰）。
 */

export interface ContextMenuItem {
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
  onClose
}: {
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  // 打开即聚焦首项：键盘用户无需再用 Tab 找菜单。
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
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

  // 贴边收拢：菜单不超出视口（侧边栏宽度有限，右键常在右侧边缘触发）。
  // 估算宽高而非实测：菜单未挂载时拿不到尺寸，实测需二次渲染（闪烁）。
  const MENU_W = 180;
  const ITEM_H = 34;
  const maxLeft = Math.max(0, window.innerWidth - MENU_W);
  const maxTop = Math.max(0, window.innerHeight - items.length * ITEM_H - 12);
  const style: React.CSSProperties = {
    left: Math.min(x, maxLeft),
    top: Math.min(y, maxTop)
  };
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t('tabs.contextMenu')}
      className="modal-panel elev-3 fixed z-50 min-w-[160px] rounded-lg border border-gray-200 bg-surface py-1"
      style={style}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 disabled:opacity-50 ${
            item.danger ? 'text-red-600' : 'text-gray-700'
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
