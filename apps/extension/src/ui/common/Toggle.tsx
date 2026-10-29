import { useControlId } from '@/ui/common/controlId';

/**
 * 开关控件（设置页与后续表单共用）。
 *
 * 可达性要点：
 * - role="switch" + aria-checked，读屏播报「开 / 关」而非「已点击」；
 * - 轨道与滑块使用 CSS 令牌（.switch / .switch-knob），尺寸和位移由 --sw-w / --sw-h 派生；
 * - ::after 透明扩区把 20px 视觉高度撑到 24px 命中区（WCAG 2.5.8）。
 */
export function Toggle({
  checked,
  onChange,
  ariaLabel,
  id,
  size = 'md',
  disabled
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
  /** 供外层 <label for> 关联；不传则取 ControlIdContext（设置页 Row 下发）。 */
  id?: string;
  /** sm = 32×18（密集表单）；md = 36×20（设置页默认）。 */
  size?: 'sm' | 'md';
  /** 禁用态（与 Button / IconButton 同口径：50% 透明度 + 非手型光标）。 */
  disabled?: boolean;
}) {
  const resolvedId = useControlId(id);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      id={resolvedId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'switch disabled:cursor-default disabled:opacity-50' + (size === 'sm' ? ' switch--sm' : '')
      }
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}
