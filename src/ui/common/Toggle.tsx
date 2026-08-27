/**
 * 开关控件（设置页与后续表单共用）。
 *
 * 可达性要点：
 * - role="switch" + aria-checked，读屏播报「开 / 关」而非「已点击」；
 * - 轨道与滑块的视觉走 CSS 令牌（.switch / .switch-knob），尺寸由 --sw-w/--sw-h 派生，
 *   不再出现 left-[18px] 这类与尺寸强耦合的魔数；
 * - ::after 透明扩区把 20px 视觉高度撑到 24px 命中区（WCAG 2.5.8）。
 */
export function Toggle({
  checked,
  onChange,
  ariaLabel,
  size = 'md'
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
  /** sm = 32×18（密集表单）；md = 36×20（设置页默认）。 */
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={'switch' + (size === 'sm' ? ' switch--sm' : '')}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}
