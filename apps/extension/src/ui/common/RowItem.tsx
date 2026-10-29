import {
  forwardRef,
  memo,
  useCallback,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react';
import { useTranslation } from '@/i18n';
import type { Density } from '@/core/schema/models';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { activatableRowProps } from '@/ui/domContract';

/** 拖拽容器接入点：listeners/style/className 合并到内部 div、ref 转发到该 div（供 dnd-kit
 *  useSortable）。键盘拖拽走主按钮（KeyboardSensor 要求 keydown 目标即 activator），
 *  容器 listeners 只承担指针拖拽，与按钮键盘监听不重复激活。 */
export interface RowItemContainer {
  ref?: (node: HTMLElement | null) => void;
  listeners?: object | undefined;
  style?: CSSProperties;
  className?: string;
  /** 由调用方决定是否在容器上挂 sortable.attributes（默认不挂，避免按钮 tabIndex 被改）。 */
  attributes?: object;
  activatorRef?: (node: HTMLElement | null) => void;
  buttonAttributes?: object;
  buttonListeners?: { onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void };
}

/**
 * 通用行视觉（标签行 / 固定条目行复用）：drag-grip + 主按钮 + badges + hover 操作组；
 * 排序用 dnd-kit，sortable 由调用方经 `container` 接入到内部 div。
 * memo 让「props 未变的行」跳过 reconcile（行是最多的叶子）。生效前提：`badges`/`actions`/
 * `secondary`/`trailing` 及 `container` 必须 memo 化，否则 memo 失效。
 */
export const RowItem = memo(
  forwardRef<
    HTMLDivElement,
    {
      /** 图标所属页面地址（不是图标地址）：图标由浏览器按页面 URL 现取。 */
      faviconPageUrl?: string;
      faviconTitle: string;
      faviconSize?: number;
      /** 自定义 favicon 替代（如固定条目的 pending 占位）。 */
      faviconFallback?: ReactNode;
      title: ReactNode;
      secondary?: ReactNode;
      isActive?: boolean;
      isMediaPlaying?: boolean;
      isDiscarded?: boolean;
      isSplitCompanion?: boolean;
      /** 分屏组括弧角色（组首/组中/组尾），视觉上连成左括号。 */
      splitGroupRole?: 'first' | 'middle' | 'last';
      isHighlighted?: boolean;
      isSearchActive?: boolean;
      isDropTarget?: boolean;
      /** 落点在结构上不接受当前拖拽类型：显示禁用态而非投放高亮（与 isDropTarget 互斥）。 */
      isDropRejected?: boolean;
      density?: Density;
      indent?: number;
      onClick?: () => void;
      onAuxClick?: (event: MouseEvent<HTMLButtonElement>) => void;
      onMouseEnter?: () => void;
      onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
      buttonTitle?: string;
      /** 标题后的额外元素（如 pin 图标）。 */
      trailing?: ReactNode;
      badges?: ReactNode;
      actions?: ReactNode;
      dragGripTitle?: string;
      container?: RowItemContainer;
    }
  >(function RowItem(
    {
      faviconPageUrl,
      faviconTitle,
      faviconSize = 16,
      faviconFallback,
      title,
      secondary,
      isActive,
      isMediaPlaying,
      isDiscarded,
      isSplitCompanion,
      splitGroupRole,
      isHighlighted,
      isSearchActive,
      isDropTarget,
      isDropRejected,
      density = 'cozy',
      indent,
      onClick,
      onAuxClick,
      onMouseEnter,
      onKeyDown,
      buttonTitle,
      trailing,
      badges,
      actions,
      dragGripTitle,
      container
    },
    ref
  ) {
    const className =
      // rounded-md(6px)：行、分区头(6px)、磁贴(8px) 三种「可按元素」的圆角须收敛到两档，
      // 否则悬停底色出现时会有圆角毛刺。
      'group relative flex items-center gap-1 rounded-md pl-1.5 pr-1.5 py-0.5 text-xs transition-base row-item' +
      (density === 'tight' ? ' density-tight' : '') +
      (density === 'cozy' ? ' density-cozy' : '') +
      (density === 'large' ? ' density-large' : '') +
      (isActive ? ' is-active' : '') +
      (isMediaPlaying ? ' is-media-playing' : '') +
      // 休眠态不再整体降透明：整行 opacity-60 会把标题压到约 2.7:1（AA 要 4.5:1），
      // 改走 .is-discarded 语义类只淡化 favicon 与标题到达标灰阶。
      (isDiscarded ? ' is-discarded' : '') +
      (isSplitCompanion ? ' is-split-companion' : '') +
      (isHighlighted ? ' is-highlighted' : '') +
      (isSearchActive ? ' is-search-active' : '') +
      (isDropTarget ? ' is-drop-target' : '') +
      (isDropRejected ? ' is-drop-rejected' : '') +
      (indent ? ' has-indent' : '') +
      (container?.className ? ' ' + container.className : '');
    // 层级缩进：pl-1.5(6px) 为首级，之后每级 +16px。仅在 indent 为真时下发内联样式：
    // 无条件下发会让 .row-item[data-split-role] 的 4px 补偿失效。
    const style = indent
      ? ({
          // 变量驱动：来源树 4 级固定吃掉 70px，窄档由 CSS 覆盖步长与上限。
          paddingLeft: `min(calc(6px + var(--indent-step) * ${indent}), var(--indent-max))`,
          ...container?.style
        } as CSSProperties)
      : container?.style;
    const { t } = useTranslation();

    // 同时支持 forwardRef 与 dnd-kit 的 setNodeRef；必须 useCallback 固定引用：
    // callback ref 变化时 React 每轮都先 ref(null) 再 ref(node)，会反复拆装 setNodeRef。
    const containerRef = container?.ref;
    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        containerRef?.(node);
      },
      [ref, containerRef]
    );

    return (
      <div
        ref={setRef}
        className={className}
        style={style}
        data-split-role={splitGroupRole ?? undefined}
        {...(container?.listeners || {})}
      >
        <button
          type="button"
          ref={container?.activatorRef}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          /* 列表级键盘漫游的定位锚点：容器靠此属性在相邻行间移焦，避免上百个 Tab 停靠点。 */
          {...activatableRowProps}
          /* 激活挂真按钮而非外层 div：div 承载 onClick 时不可聚焦也无角色，且点击行内空白/徽章
             区也会激活（鼠标可执行区域比键盘大一圈）。 */
          onClick={onClick}
          onAuxClick={onAuxClick}
          onMouseEnter={onMouseEnter}
          onKeyDown={(event) => {
            container?.buttonListeners?.onKeyDown?.(event);
            onKeyDown?.(event);
          }}
          title={buttonTitle}
          {...(container?.buttonAttributes || {})}
        >
          {/* 拖拽手柄悬停时覆盖 favicon 原位（零布局占位）：整行鼠标可拖、键盘走 Space，
            grip 仅视觉提示；底色用 --row-bg 与行底一致，浮现时盖住 favicon。 */}
          <span className="row-favicon relative inline-flex shrink-0 items-center">
            {faviconFallback || (
              <Favicon pageUrl={faviconPageUrl} title={faviconTitle} size={faviconSize} />
            )}
            <span
              className="drag-grip"
              title={dragGripTitle || t('拖拽调整顺序（按住此处可拖到收藏夹）')}
              aria-hidden="true"
            >
              <Icon d={Icons.grip} className="h-3.5 w-3.5" />
            </span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate title-text">{title}</span>
            {secondary}
          </span>
          {trailing}
        </button>
        {badges ? (
          <span className="row-badges inline-flex shrink-0 items-center">{badges}</span>
        ) : null}
        {actions ? (
          /* 行内操作区禁止成为指针拖拽起点：拖拽监听挂整行容器，PointerSensor 距离 4px 即激活，
             在此区按下并轻微移动会把点击吞成拖拽。与 SectionHead 的 .section-head-actions 同方案。 */
          <span
            className="contents"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </span>
        ) : null}
      </div>
    );
  })
);
