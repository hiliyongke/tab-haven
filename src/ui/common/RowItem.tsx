import { forwardRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
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
 */
export const RowItem = forwardRef<HTMLDivElement, {
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
}>(function RowItem(
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
    density = 'compact',
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
    'group relative flex items-center gap-1 rounded pl-1.5 pr-1.5 py-[2px] text-xs transition-base hover:bg-gray-50 row-item' +
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
    ? ({ paddingLeft: `${Math.min(8 + indent * 16, 48)}px`, ...container?.style } as CSSProperties)
    : container?.style;
  const { t } = useTranslation();

  // 同时支持两种 ref 来源：外部传入的 ref（forwardRef）和 dnd-kit 的 setNodeRef。
  const setRef = (node: HTMLDivElement | null) => {
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    container?.ref?.(node);
  };

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
          {faviconFallback || <Favicon src={faviconSrc} title={faviconTitle} size={faviconSize} />}
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
      {badges ? <span className="row-badges inline-flex shrink-0 items-center">{badges}</span> : null}
      {actions}
    </div>
  );
});