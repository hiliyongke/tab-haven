import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from '@/i18n';
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
  countLabel,
  onToggle,
  toggleTitle,
  expanded,
  panelId,
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
  /**
   * 计数的量纲（读屏与 tooltip 用）：默认「共 N 个标签」。
   *
   * 同一个胶囊在不同模块里表示的**不是同一种东西** —— 模块级（站点分组、
   * 收藏夹）传的是分组数/文件夹数，分区级传的是标签数。读屏必须按传入的量纲
   * 播报，否则「站点分组 5」「收藏夹 3」会被读成「共 N 个标签」。
   * 中文原文由调用方传入（t() 已本地化后的字符串）。
   */
  countLabel?: string;
  onToggle?: () => void;
  /** 折叠/展开的 tooltip：只有 aria-label 时鼠标用户悬停拿不到任何提示。 */
  toggleTitle?: string;
  /** 折叠按钮的 aria-expanded（存在 onToggle 时必传，读屏用户据此感知展开/折叠态）。 */
  expanded?: boolean;
  /** 被折叠内容容器的 id：与 aria-expanded 配套的 aria-controls，
      否则读屏无法把「开关」与「被折叠的内容」关联起来。 */
  panelId?: string;
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
          title={t('拖拽调整顺序（按住此处可拖到收藏夹）')}
          ref={dragKeyboard.activatorRef}
          {...dragKeyboard.attributes}
          aria-label={t('拖拽调整顺序（按住此处可拖到收藏夹）')}
          onKeyDown={dragKeyboard.listeners?.onKeyDown}
        >
          <Icon d={Icons.grip} className="h-3 w-3" />
        </button>
      )}
      {onToggle ? (
        <button
          type="button"
          className="toggle"
          /* aria-label 只给分组名时，读屏播报「站点A，折叠按钮」，用户得自己推断
             这是展开/折叠开关；补上动作语义。同时必须有 title：只有 aria-label 时
             鼠标用户悬停拿不到任何提示，而相邻同类按钮都有。 */
          aria-label={expanded ? t('收起：{{title}}', { title }) : t('展开：{{title}}', { title })}
          title={toggleTitle}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          {content}
        </button>
      ) : (
        <div className="toggle">{content}</div>
      )}
      {/* 裸数字对读屏是孤立量词（「12」），可见数字对读屏隐藏、改播完整语义 */}
      <span className="count-pill" aria-hidden="true">
        {count}
      </span>
      <span className="sr-only">{countLabel ?? t('共 {{count}} 个标签', { count })}</span>
      {mediaIndicator}
      {action && (
        <span className="section-head-actions" onPointerDown={(event) => event.stopPropagation()}>
          {action}
        </span>
      )}
      {onClose && (
        <button
          type="button"
          // is-danger：悬停/键盘聚焦转砖红（静默态保持中性灰，与行内「关闭」同语义），
          // 让「整批关闭」在密集分组头部可被一眼认出是破坏性操作。
          className="row-action close-site is-danger"
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
