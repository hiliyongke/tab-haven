import type { ReactNode } from 'react';
import { SectionHead } from '@/ui/common/SectionHead';
import { dropFeedbackClass, type DropOutcome } from '@/ui/dnd/dropPolicy';

/**
 * 分类模块外壳：固定标签 / 固定空间 / 站点分组 / 未分组 四类共用同一个视觉壳。
 *
 * 结构一致：`<section className="section-card {variant}">` + `<SectionHead title count action>` + children。
 * - `className` 用于变体标识（`module-shell` / `is-pinned` / 等）；
 * - `setNodeRef` + `isOver` + `outcome` 用于接收拖入投放（固定空间外壳使用）；
 * - 落点反馈一律由 `dropFeedbackClass` 给出（`ui/dnd/dropPolicy` 唯一口径）。
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
  outcome,
  'aria-label': ariaLabel,
  icon,
  accent
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
   * 落点判定结果（`classifyDrop` 的结果）。
   * 三态一一对应视觉：accept 高亮 / reject 禁用 / noop 不给反馈
   * （拖拽回原位没有变化，画个高亮反而像「放进去会做事」）。
   */
  outcome?: DropOutcome;
  /** a11y 标签（如 "固定空间"）。 */
  'aria-label'?: string;
  /** 标题前的强调色条（固定空间用品牌色标识「长期资产归口」）。 */
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <section
      ref={setNodeRef}
      aria-label={ariaLabel}
      className={
        'section-card' +
        (className ? ' ' + className : '') +
        dropFeedbackClass(isOver ?? false, outcome)
      }
    >
      <SectionHead
        title={title}
        count={count}
        countLabel={countLabel}
        action={action}
        accent={accent}
        icon={icon}
      />
      {children}
    </section>
  );
}
