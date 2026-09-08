import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from '@/ui/common/Icon';

/** 卡片头部：标题 + 计数胶囊；可点击折叠，可选关闭（解散网站组）。
 *  排序用 dnd-kit：指针拖拽挂整个头部（dragHandleProps），
 *  键盘拖拽挂专用手柄按钮（dragKeyboard，Space/Enter + 方向键），
 *  避免与头部内 toggle 按钮的按键语义冲突。
 *  固定文件夹头也复用此组件，保证视觉与分组一致。 */
export function SectionHead({
  icon,
  accent,
  title,
  count,
  onToggle,
  expanded,
  onClose,
  closeTitle,
  action,
  mediaIndicator,
  dragHandleProps,
  dragKeyboard
}: {
  icon?: ReactNode;
  /** 分组强调色；存在时在标题前渲染一条竖色条。 */
  accent?: string;
  title: string;
  count: number;
  onToggle?: () => void;
  /** 折叠按钮的 aria-expanded（存在 onToggle 时必传，读屏用户据此感知展开/折叠态）。 */
  expanded?: boolean;
  onClose?: () => void;
  closeTitle?: string;
  /** 标题行右侧的可选操作按钮（如「存为固定文件夹」）。 */
  action?: ReactNode;
  /** 分组内媒体播放提示，可在折叠时显示并快速定位。 */
  mediaIndicator?: ReactNode;
  /** dnd-kit 指针排序监听（挂整个头部）。 */
  dragHandleProps?: Record<string, unknown>;
  /** dnd-kit 键盘拖拽接线（挂专用手柄按钮：attributes + 键盘监听 + activator ref）。 */
  dragKeyboard?: {
    attributes: Record<string, unknown>;
    listeners?: { onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void };
    activatorRef: (node: HTMLElement | null) => void;
  };
}) {
  const { t } = useTranslation();
  const content = (
    <>
      {/* 拖拽手柄浮现时前导（色条+icon）淡出让位——与行内 favicon 交换同款零占位模式 */}
      <span className="head-leading" aria-hidden="true">
        {accent && (
          <span className="h-3.5 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
        )}
        {icon}
      </span>
      <span className="title">{title}</span>
    </>
  );
  return (
    <div className="section-head" {...dragHandleProps}>
      {dragKeyboard && (
        <button
          type="button"
          className="row-action section-drag-handle"
          title={t('tabs.dragToMove')}
          ref={dragKeyboard.activatorRef}
          {...dragKeyboard.attributes}
          aria-label={t('tabs.dragToMove')}
          onKeyDown={dragKeyboard.listeners?.onKeyDown}
        >
          <Icon d={Icons.grip} className="h-3 w-3" />
        </button>
      )}
      {onToggle ? (
        <button
          type="button"
          className="toggle"
          aria-label={title}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {content}
        </button>
      ) : (
        <div className="toggle">{content}</div>
      )}
      <span className="count-pill">{count}</span>
      {mediaIndicator}
      {action && (
        <span className="section-head-actions" onPointerDown={(event) => event.stopPropagation()}>
          {action}
        </span>
      )}
      {onClose && (
        <button
          type="button"
          className="row-action close-site"
          title={closeTitle}
          aria-label={closeTitle}
          onClick={onClose}
        >
          <Icon d={Icons.close} className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
