import type { ReactNode } from 'react';
import { SectionHead } from '@/ui/common/SectionHead';

/**
 * 分类模块外壳：固定标签 / 固定空间 / 站点分组 / 未分组 四类共用同一个视觉壳。
 *
 * 结构一致：`<section className="section-card {variant}">` + `<SectionHead title count action>` + children。
 * - `className` 用于变体标识（`module-shell` / `is-pinned` / 等）；
 * - `setNodeRef` + `isOver` 用于接收拖入投放（固定空间外壳使用）；
 * - `disabled` 用于纯展示型模块（如未分组）跳过 sortable/droppable 装配。
 */
export function CategoryModule({
  title,
  count,
  action,
  children,
  className,
  setNodeRef,
  isOver,
  'aria-label': ariaLabel,
  icon,
  accent,
  onToggle,
  collapsed
}: {
  title: string;
  count: number;
  action?: ReactNode;
  children?: ReactNode;
  /** 附加在 section-card 上的变体 class（module-shell / is-pinned 等）。 */
  className?: string;
  /** droppable 目标节点引用（固定空间外壳接收拖入时使用）。 */
  setNodeRef?: (node: HTMLElement | null) => void;
  /** droppable 高亮状态。 */
  isOver?: boolean;
  /** a11y 标签（如 "固定空间"）。 */
  'aria-label'?: string;
  /** 标题前的强调色条（固定空间用品牌色标识「长期资产归口」）。 */
  accent?: string;
  /** 折叠相关：仅固定空间外壳使用；不传则头不可折叠、children 恒渲染。 */
  icon?: ReactNode;
  onToggle?: () => void;
  collapsed?: boolean;
}) {
  return (
    <section
      ref={setNodeRef}
      aria-label={ariaLabel}
      className={
        'section-card' + (className ? ' ' + className : '') + (isOver ? ' is-drop-target' : '')
      }
    >
      <SectionHead
        title={title}
        count={count}
        action={action}
        accent={accent}
        icon={icon}
        onToggle={onToggle}
        expanded={onToggle ? !collapsed : undefined}
      />
      {!collapsed && children}
    </section>
  );
}
