/** 线性图标（stroke 风格，全部视图共用）。 */
export function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** 常用图标路径（与展示组件解耦，便于统一更换风格）。 */
export const Icons = {
  mute: 'M11 5 6 9H2v6h4l5 4V5z',
  muted: 'M11 5 6 9H2v6h4l5 4V5z M22 9l-6 6 M16 9l6 6',
  pin: 'M12 17v5 M9 3h6v2l-1 5 3 4v2H7v-2l3-4-1-5V3z',
  close: 'M18 6 6 18 M6 6l12 12',
  chevron: 'm9 6 6 6-6 6',
  plus: 'M12 5v14 M5 12h14',
  split: 'M8 3H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Z M20 3h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Z M8 15H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Z M20 15h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Z'
} as const;
