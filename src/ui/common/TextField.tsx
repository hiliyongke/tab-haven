import type { KeyboardEvent, RefObject } from 'react';

/**
 * 统一文本输入框（弹窗/表单共用）。
 * 收敛此前散落的 `rounded border border-gray-200 px-2 py-1.5 focus:border-accent-500` 系列。
 * 支持受控（value）与非受控（defaultValue）两种用法。
 */
export function TextField({
  type = 'text',
  size = 'md',
  value,
  defaultValue,
  placeholder,
  min,
  max,
  className,
  onChange,
  onKeyDown,
  inputRef,
  ariaLabel,
  inputProps
}: {
  type?: 'text' | 'number' | 'search';
  /** md = 弹窗/表单；lg = 搜索主输入（popup/sidepanel）。 */
  size?: 'md' | 'lg';
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  className?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** 程序化标签：placeholder 不能替代 label，读屏需要 aria-label 关联。 */
  ariaLabel?: string;
  /** 额外的 input 属性透传（如 popup 搜索框的 role/aria-activedescendant）。 */
  inputProps?: Record<string, unknown>;
}) {
  return (
    <input
      ref={inputRef}
      type={type}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      min={min}
      max={max}
      aria-label={ariaLabel}
      className={
        'rounded border bg-surface text-sm text-gray-800 focus:border-accent-500' +
        (size === 'lg'
          ? ' border-gray-200 px-3 py-2'
          : ' border-gray-200 px-2 py-1.5') +
        (className ? ' ' + className : '')
      }
      onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      onKeyDown={onKeyDown}
      {...inputProps}
    />
  );
}
