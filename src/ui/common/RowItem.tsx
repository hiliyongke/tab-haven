import {
  forwardRef,
  memo,
  useCallback,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';

/** 拖拽容器接入点：listeners / style / className 会合并到 RowItem 内部 div，
 *  ref 转发到该 div。供 dnd-kit useSortable 接入。
 *  键盘拖拽走主按钮：KeyboardSensor 要求 keydown 目标即 activator 本体，
 *  因此 activatorRef/buttonAttributes/buttonListeners 挂到主按钮上，
 *  容器 listeners 只承担指针拖拽（整行可拖），与按钮键盘监听互不重复激活。 */
interface RowItemContainer {
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
 * 通用行视觉（标签行 / 固定条目行复用）：
 * drag-grip + 主按钮（favicon + title + secondary + trailing）+ badges + hover 操作组。
 * 排序用 dnd-kit：sortable 由调用方通过 `container` 接入到内部 div。
 *
 * memo 化的意义：RowItem 是数量最多的叶子（每个标签一行），父级任一次重渲染都会
 * 波及全部行。memo 让「props 未变的行」直接跳过 reconcile。
 *
 * 生效前提（调用方必须满足，否则 memo 100% 失效）：
 *  1. `badges` / `actions` / `secondary` / `trailing` 等 ReactNode 必须 memo 化；
 *  2. `container` 必须 memo 化 —— dnd-kit 的 useSortable 每次渲染都返回全新对象，
 *     直接透传会让每一行都无法命中 memo（历史问题，已在 TabRow 内用标量依赖修正）。
 */
export const RowItem = memo(
  forwardRef<
    HTMLDivElement,
    {
      faviconSrc?: string;
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
      density?: 'compact' | 'cozy';
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
      faviconSrc,
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
      'group relative flex items-center gap-1 rounded pl-1.5 pr-1.5 py-[2px] text-xs transition-base row-item' +
      (density === 'cozy' ? ' density-cozy' : '') +
      (isActive ? ' is-active' : '') +
      (isMediaPlaying ? ' is-media-playing' : '') +
      (isDiscarded ? ' opacity-60' : '') +
      (isSplitCompanion ? ' is-split-companion' : '') +
      (isHighlighted ? ' is-highlighted' : '') +
      (isSearchActive ? ' is-search-active' : '') +
      (isDropTarget ? ' is-drop-target' : '') +
      (indent ? ' has-indent' : '') +
      (container?.className ? ' ' + container.className : '');
    const style = indent
      ? ({
          paddingLeft: `${Math.min(8 + indent * 16, 48)}px`,
          ...container?.style
        } as CSSProperties)
      : container?.style;
    const { t } = useTranslation();

    // 同时支持两种 ref 来源：外部传入的 ref（forwardRef）和 dnd-kit 的 setNodeRef。
    // 必须 useCallback 固定引用：callback ref 引用变化时 React 每轮渲染都先
    // ref(null) 再 ref(node)，会把 dnd-kit 的 setNodeRef 反复拆装
    // （MeasuringStrategy.Always 下拖拽中的行重渲染触发额外重测）。
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
            grip 仅为视觉提示；底色用 --row-bg 与行底一致，浮现时自然盖住 favicon。 */}
          <span className="row-favicon relative inline-flex shrink-0 items-center">
            {faviconFallback || (
              <Favicon src={faviconSrc} title={faviconTitle} size={faviconSize} />
            )}
            <span
              className="drag-grip"
              title={dragGripTitle || t('tabs.dragToMove')}
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
          /* 行内操作按钮区禁止成为指针拖拽起点（display:contents 不产生额外盒子）：
             拖拽监听挂在整行容器（RowItem 外层 div），PointerSensor 距离 4px 即可激活，
             在此区域内按下并轻微移动会把一次点击吞成拖拽 → 关闭/固定/静音等按钮
             “点一下没反应”。与 SectionHead 的 .section-head-actions 同一拦截方案。 */
          <span className="contents" onPointerDown={(event) => event.stopPropagation()}>
            {actions}
          </span>
        ) : null}
      </div>
    );
  })
);
