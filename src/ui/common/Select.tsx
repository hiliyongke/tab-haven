/** 下拉选择控件（设置页与后续表单共用）。 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** 程序化标签：视觉 label 由外层 SettingRow 提供，读屏需要 aria-label 关联。 */
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
      /* border-control 而非 border-gray-200：下拉框是控件边界，须满足 1.4.11 的 3:1。
         同时补齐 min-h-6（24px，WCAG 2.5.8 最小目标尺寸）。 */
      className="min-h-6 rounded border border-control bg-surface px-2 py-1 text-xs text-gray-800 transition-base focus:border-accent-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
