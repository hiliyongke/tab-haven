import { useControlId } from '@/ui/common/controlId';

/**
 * 复选框（与 `Toggle` 同族的表单原语）。
 *
 * 与 Toggle 的对齐点：
 *  - id 同样走 `useControlId`（设置页 Row 下发，供 `<label for>` 关联）；
 *  - 禁用态同口径（50% 透明度 + 非手型光标）；
 *  - 可访问名只给 `ariaLabel` 一个入口，不与可见文案各写一份。
 *
 * 尺寸、勾选项色（accent-color）与收缩行为收在 main.css 的 `.checkbox`，
 * 走 @theme 的 `--color-accent-*` 刻度，换主题才能跟着走。
 */
export function Checkbox({
  checked,
  onChange,
  ariaLabel,
  id,
  disabled,
  className
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
  /** 供外层 <label for> 关联；不传则取 ControlIdContext（设置页 Row 下发）。 */
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const resolvedId = useControlId(id);
  return (
    <input
      type="checkbox"
      id={resolvedId}
      className={'checkbox' + (className ? ' ' + className : '')}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
