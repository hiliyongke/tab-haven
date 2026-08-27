import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';

/** 单行与多行共用的元素类型（textarea 没有 type/min/max）。 */
type FieldElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * 统一文本输入控件（弹窗 / 表单 / 搜索框共用）。
 *
 * 收敛此前散落的 `rounded border border-gray-200 bg-surface px-2 py-1.5 …` 系列：
 * 该样式串曾在 9 处重复，且统一使用 border-gray-200 —— 对 surface 仅 1.33:1，
 * 不满足 WCAG 1.4.11 的 3:1。现在边框统一走 --border-control 令牌。
 *
 * 支持单行（input）与多行（textarea），以及受控 / 非受控两种用法。
 */
export function TextField({
  type = 'text',
  size = 'md',
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
  inputProps
}: {
  type?: 'text' | 'number' | 'search' | 'password';
  /** lg = 搜索主输入；md = 弹窗/表单默认；sm = 密集行内编辑。 */
  size?: 'lg' | 'md' | 'sm';
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
  /** 额外的原生属性透传（如 popup 搜索框的 role/aria-activedescendant）。 */
  inputProps?: Record<string, unknown>;
}) {
  const shared = {
    ref: inputRef as RefObject<HTMLInputElement & HTMLTextAreaElement> | undefined,
    value,
    defaultValue,
    placeholder,
    'aria-label': ariaLabel,
    onChange: onChange
      ? (event: ChangeEvent<FieldElement>) => onChange(event.target.value)
      : undefined,
    onKeyDown,
    onBlur,
    ...inputProps
  } as const;

  const base =
    'w-full rounded border border-control bg-surface text-gray-800 transition-base focus:border-accent-500' +
    (size === 'lg' ? ' px-3 py-2 text-sm' : '') +
    (size === 'md' ? ' px-2 py-1.5 text-sm' : '') +
    (size === 'sm' ? ' px-1.5 py-0.5 text-xs' : '') +
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
