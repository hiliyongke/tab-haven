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
      className="rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-800 outline-none focus:border-accent-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
