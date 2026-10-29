import type { ChangeEvent, HTMLAttributes, KeyboardEvent, RefObject } from 'react';
import { useControlId } from '@/ui/common/controlId';

/** 单行与多行共用的元素类型（textarea 没有 type/min/max）。 */
type FieldElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * 统一文本输入控件（弹窗/表单/搜索框共用），支持单行/多行与受控/非受控。
 * 边框统一走 --border-control 令牌：border-gray-200 对 surface 仅 1.33:1，不达 WCAG 1.4.11 的 3:1。
 * 单行只留下边框、聚焦转品牌色（下划线式，与侧边栏搜索框同语言）；多行保留完整描边框，
 * 否则看不出可输入范围的上下界。
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
  /** `outline` = 常规带边框；`bare` = 内嵌于已有容器的无边框输入（命名框等），
   *  否则内嵌输入会绕过本控件写裸 `<input>`，丢失边框令牌/命中下限/aria-label 收口。 */
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
  /** 额外原生属性透传（role/aria-activedescendant/spellCheck 等）。收紧到原生属性：
   *  `Record<string, unknown>` 会让拼错的键逃逸且展开在最后会静默覆盖 aria-label/id。
   *  取公共部分而非 InputHTMLAttributes：后者的事件类型展开进 `<textarea>` 会编译失败。 */
  inputProps?: Omit<HTMLAttributes<FieldElement>, 'onChange' | 'id'>;
}) {
  const shared = {
    // 展开必须在前：本控件自己下发的 aria-label / id / onChange 是收口的一部分，
    // 放在后面会被透传的同名键覆盖掉（且没有任何报错）。
    ...inputProps,
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
    onBlur
  } as const;

  /* 三档高度与 Button 同刻度（sm/xs 24px、md 32px、lg 36px），都带 min-h 守 WCAG 2.5.8 的 24px。 */
  const base =
    'w-full text-gray-800 transition-base ' +
    (variant === 'bare'
      ? 'bg-transparent focus:outline-none'
      : multiline
        ? 'rounded border border-control bg-surface focus:border-accent-500'
        : /* input-line：下划线式输入的承载，与搜索框/命令面板共用 main.css 那组声明，
             别在此另写 border-b —— 改焦点行为会漏掉这处。 */
          'input-line') +
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
