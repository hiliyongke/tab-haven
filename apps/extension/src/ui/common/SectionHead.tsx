import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from '@/i18n';
import { preserveFocusBeforeCollapse } from '@/ui/domContract';
import { Icons } from '@/ui/common/Icon';
import { RowActionButton } from '@/ui/common/RowActionButton';

/** 卡片头部：标题 + 计数胶囊；可点击折叠，可选关闭（解散网站组）。排序用 dnd-kit：
 *  指针拖拽挂整个头部（dragHandleProps），键盘拖拽挂专用手柄按钮（dragKeyboard，
 *  Space/Enter + 方向键），避免与头部内 toggle 按钮的按键语义冲突。固定文件夹头也复用此组件。 */
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
  /** 计数的量纲（读屏与 tooltip 用）：默认「共 N 个标签」。同一胶囊在不同模块表示的不是
   *  同一种东西（模块级传分组/文件夹数，分区级传标签数），须按传入量纲播报。
   *  中文原文由调用方传入（t() 已本地化后的字符串）。 */
  countLabel?: string;
  onToggle?: () => void;
  /** 折叠/展开的 tooltip：只有 aria-label 时鼠标用户悬停拿不到任何提示。 */
  toggleTitle?: string;
  /** 折叠按钮的 aria-expanded（存在 onToggle 时必传，读屏据此感知展开/折叠态）。 */
  expanded?: boolean;
  /** 被折叠内容容器的 id：与 aria-expanded 配套的 aria-controls。 */
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
        /* 走 RowActionButton：形态只有一个实现，dnd-kit 需要的 ref 与 attributes 由组件透传。 */
        <RowActionButton
          ref={dragKeyboard.activatorRef}
          label={t('拖拽调整顺序（按住此处可拖到收藏夹）')}
          icon={Icons.grip}
          iconClass="h-3 w-3"
          className="section-drag-handle"
          {...dragKeyboard.attributes}
          onKeyDown={dragKeyboard.listeners?.onKeyDown}
        />
      )}
      {onToggle ? (
        <button
          type="button"
          className="toggle"
          /* aria-label 补上动作语义（否则只报「站点A，折叠按钮」）；必须有 title：只有 aria-label 时
             鼠标用户悬停拿不到提示。 */
          aria-label={expanded ? t('收起：{{title}}', { title }) : t('展开：{{title}}', { title })}
          title={toggleTitle}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => {
            // 折叠会让本分区 body 卸载：若此刻焦点恰在被折叠的行内（键盘漫游进某行后
            // 由程序化/快捷键触发折叠，或焦点未自动转移到 toggle 的环境），先把它移到
            // 存活的分区头 toggle，避免焦点随行卸载掉回 body。正常点击 toggle 时焦点本
            // 就在 toggle 上，此调用为空操作。
            preserveFocusBeforeCollapse();
            onToggle();
          }}
        >
          {content}
        </button>
      ) : (
        <div className="toggle">{content}</div>
      )}
      {/* 裸数字对读屏是孤立量词，可见数字对读屏隐藏、改播完整语义 */}
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
        /* is-danger：悬停/聚焦转砖红（静默态中性灰），让「整批关闭」一眼可辨是破坏性操作。
           label 兜底到通用「关闭」：closeTitle 可选，漏传会得到无名按钮。 */
        <RowActionButton
          icon={Icons.close}
          label={closeTitle ?? t('关闭')}
          tooltip={closeTitle}
          danger
          className="close-site"
          onClick={onClose}
        />
      )}
    </div>
  );
}
