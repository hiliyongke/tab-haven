import type { ReactNode } from 'react';
import { Icon, Icons } from '@/ui/common/Icon';

/** 卡片头部：标题 + 计数胶囊；可点击折叠，可选关闭（解散网站组）。
 *  排序用 dnd-kit（head 容器承载 listeners）；跨容器拖出（到固定空间）由全局 DndContext 处理。
 *  固定文件夹头也复用此组件，保证视觉与分组一致。 */
export function SectionHead({
  icon,
  accent,
  title,
  count,
  onToggle,
  onClose,
  closeTitle,
  action,
  mediaIndicator,
  dragHandleRef,
  dragHandleProps
}: {
  icon?: ReactNode;
  /** 分组强调色；存在时在标题前渲染一条竖色条。 */
  accent?: string;
  title: string;
  count: number;
  onToggle?: () => void;
  onClose?: () => void;
  closeTitle?: string;
  /** 标题行右侧的可选操作按钮（如「存为固定文件夹」）。 */
  action?: ReactNode;
  /** 分组内媒体播放提示，可在折叠时显示并快速定位。 */
  mediaIndicator?: ReactNode;
  /** dnd-kit 排序节点引用。 */
  dragHandleRef?: (node: HTMLDivElement | null) => void;
  /** dnd-kit 排序监听（attributes + listeners）。 */
  dragHandleProps?: Record<string, unknown>;
}) {
  const content = (
    <>
      {accent && (
        <span
          className="h-3.5 w-0.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden="true"
        />
      )}
      {icon}
      <span className="title">{title}</span>
    </>
  );
  return (
    <div
      className="section-head"
      ref={dragHandleRef}
      {...dragHandleProps}
    >
      {onToggle ? (
        <button
          type="button"
          className="toggle"
          aria-label={title}
          onClick={onToggle}
        >
          {content}
        </button>
      ) : (
        <div className="toggle">{content}</div>
      )}
      <span className="count-pill">{count}</span>
      {mediaIndicator}
      {action}
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
