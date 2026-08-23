/** 开关控件（设置页与后续表单共用）。 */
export function Toggle({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={
        'relative h-5 w-9 rounded-full transition-base ' +
        (checked ? 'bg-accent-500' : ' bg-gray-300')
      }
    >
      <span
        className={
          'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-base ' +
          (checked ? ' left-[18px]' : ' left-0.5')
        }
      />
    </button>
  );
}
