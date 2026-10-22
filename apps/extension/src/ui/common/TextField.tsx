import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import { useControlId } from '@/ui/common/controlId';

/** 单行与多行共用的元素类型（textarea 没有 type/min/max）。 */
type FieldElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * 统一文本输入控件（弹窗 / 表单 / 搜索框共用）。
 *
 * 统一收口 `rounded border border-gray-200 bg-surface px-2 py-1.5 …` 这类样式串：
 * 散落各处时边框统一用 border-gray-200 —— 对 surface 仅 1.33:1，
 * 不满足 WCAG 1.4.11 的 3:1。此处边框统一走 --border-control 令牌。
 *
 * 支持单行（input）与多行（textarea），以及受控 / 非受控两种用法。
 */
export function TextField({
  type = 'text',
  size = 'md',
  variant = 'outline',
  multiline = false,
  rows = 3,
  resize = false,
  value,
  defaultValue,
  placeholder,
  min,
  max,
  className,
  onChange,
  onKeyDown,
  onBlur,
  inputRef,
  ariaLabel,
  id,
  inputProps
}: {
  type?: 'text' | 'number' | 'search' | 'password';
  /** lg = 搜索主输入；md = 弹窗/表单默认；sm = 密集行内编辑。 */
  size?: 'lg' | 'md' | 'sm';
  /**
   * `outline` = 常规带边框输入；`bare` = 内嵌于已有容器的无边框输入。
   *
   * 为什么要这个变体：内嵌输入（如「保存快照」行内的命名框）此前绕过本控件直接写
   * 裸 `<input>` —— 只因为本控件固定带边框与底色。绕过一次，边框令牌、
   * 命中下限、aria-label 这套收口就在那里失效一次。
   */
  variant?: 'outline' | 'bare';
  /** 渲染为 textarea（多行文本，如规则列表 / 批量导入）。 */
  multiline?: boolean;
  /** 多行模式下的可见行数。 */
  rows?: number;
  /** 多行模式下是否允许拖动改变高度（默认 false，避免把弹窗布局拖乱）。 */
  resize?: boolean;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  className?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<FieldElement>) => void;
  onBlur?: () => void;
  inputRef?: RefObject<FieldElement | null>;
  /** 程序化标签：placeholder 不能替代 label，读屏需要 aria-label 关联。 */
  ariaLabel?: string;
  /** 供外层 <label for> 关联；不传则取 ControlIdContext（设置页 Row 下发）。 */
  id?: string;
  /** 额外的原生属性透传（如搜索框的 role/aria-activedescendant）。 */
  inputProps?: Record<string, unknown>;
}) {
  const shared = {
    ref: inputRef as RefObject<HTMLInputElement & HTMLTextAreaElement> | undefined,
    value,
    defaultValue,
    placeholder,
    'aria-label': ariaLabel,
    id: useControlId(id),
    onChange: onChange
      ? (event: ChangeEvent<FieldElement>) => onChange(event.target.value)
      : undefined,
    onKeyDown,
    onBlur,
    ...inputProps
  } as const;

  /* 三档高度下限与 Button 同刻度（sm/xs 24px、md 32px、lg 36px）。
     三档都要有 min-h：sm 不加时实测 22px，低于 WCAG 2.5.8 的 24px 下限，
     且 px-1.5(6px) / py-0.5(2px) 脱 4px 网格。 */
  const base =
    'w-full rounded text-gray-800 transition-base ' +
    (variant === 'bare'
      ? 'bg-transparent focus:outline-none'
      : 'border border-control bg-surface focus:border-accent-500') +
    (size === 'lg' ? ' px-3 py-1.5 text-sm min-h-9' : '') +
    (size === 'md' ? ' px-2 py-1 text-sm min-h-8' : '') +
    (size === 'sm' ? ' px-2 py-0.5 text-xs min-h-6' : '') +
    (className ? ' ' + className : '');

  if (multiline) {
    return (
      <textarea
        {...shared}
        rows={rows}
        className={base + (resize ? ' resize-y' : ' resize-none')}
      />
    );
  }

  return <input {...shared} type={type} min={min} max={max} className={base} />;
}
