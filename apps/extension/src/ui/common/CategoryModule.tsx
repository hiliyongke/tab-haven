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
  countLabel,
  action,
  children,
  className,
  setNodeRef,
  isOver,
  dropRejected,
  'aria-label': ariaLabel,
  icon,
  accent,
  onToggle,
  collapsed
}: {
  title: string;
  count: number;
  /** 计数量纲（读屏播报）：模块级传「共 N 个分组/文件夹」，缺省为「共 N 个标签」。 */
  countLabel?: string;
  action?: ReactNode;
  children?: ReactNode;
  /** 附加在 section-card 上的变体 class（module-shell / is-pinned 等）。 */
  className?: string;
  /** droppable 目标节点引用（固定空间外壳接收拖入时使用）。 */
  setNodeRef?: (node: HTMLElement | null) => void;
  /** droppable 高亮状态。 */
  isOver?: boolean;
  /**
   * 落点在结构上不接受当前拖拽类型：渲染禁用态而不是投放高亮。
   * 两态互斥，判断口径由 ui/dnd/dropPolicy 统一给出。
   */
  dropRejected?: boolean;
  /** a11y 标签（如 "固定空间"）。 */
  'aria-label'?: string;
  /** 标题前的强调色条（固定空间用品牌色标识「长期资产归口」）。 */
  accent?: string;
  /**
   * 折叠相关：传 onToggle 才渲染可点击头部，缺省为纯展示头、children 恒渲染。
   * 现无调用方使用（收藏夹作为一级标题刻意不折叠），保留是因为它与
   * SectionHead 的折叠语义同源，后续给某个模块加折叠时不必重写一套。
   */
  icon?: ReactNode;
  onToggle?: () => void;
  collapsed?: boolean;
}) {
  return (
    <section
      ref={setNodeRef}
      aria-label={ariaLabel}
      className={
        'section-card' +
        (className ? ' ' + className : '') +
        (isOver ? (dropRejected ? ' is-drop-rejected' : ' is-drop-target') : '')
      }
    >
      <SectionHead
        title={title}
        count={count}
        countLabel={countLabel}
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
