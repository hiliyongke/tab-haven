import type { ReactNode } from 'react';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'secondary-outline'
  | 'ghost'
  | 'accent-ghost'
  | 'warn-ghost'
  | 'danger'
  | 'danger-ghost'
  | 'soft-outline';

/**
 * 每段末尾的 `disabled:hover:*` 不是冗余：原生 `<button disabled>` 在 Chrome 里
 * **仍然匹配 :hover**，禁用态会继续播放 hover 变色（主按钮 hover 更深，看着像还能点）。
 * 须显式把 hover 值回落到静态值（逐个组件打补丁会漏）。
 */
const BUTTON_TONES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-on-accent hover:bg-accent-700 disabled:hover:bg-accent-600',
  secondary: 'text-gray-600 hover:bg-gray-100 disabled:hover:bg-transparent',
  /* 描边次级：与 secondary 同骨架，多一条可见边界。
     此前「带边框的灰底按钮」由调用点在 className 里补 border + hover:bg-gray-50，
     而 secondary 自带 hover:bg-gray-100 —— 两个 hover:* 同属 utilities 层、特异性相同，
     产物里 gray-100 在后，调用点的意图被静默覆盖（SnapshotListView 实测）。
     收进变体后「是灰底还是白底描边」不再取决于编译顺序。 */
  'secondary-outline':
    'border border-control bg-surface font-medium text-gray-600 hover:bg-gray-50 disabled:hover:bg-surface',
  /* ghost / accent-ghost：无底色无边框的「文字按钮」（取消 / 从 OneTab 导入 /
     洞察行动出口同款）。此前这类按钮在面板里各写一套 class 串，min-h-6 命中
     下限与 disabled:hover 兜底只改一处就会漏另一处 —— 收进变体后这些口径
     与其余六个变体同源（尤其 disabled:hover 的兜底，见文件头注释）。 */
  ghost: 'text-gray-500 hover:bg-gray-100 disabled:hover:bg-transparent',
  /* 强调色文字按钮（习惯洞察的行动出口）。与 ghost 同骨架、只换强调色，
     而不是让调用方用 className 覆盖 ghost 的 text-gray-500：两个 text-* 工具类
     同属 utilities 层、特异性相同，胜负取决于 Tailwind 的**输出顺序**，
     把「行动按钮是绿是灰」交给编译顺序不可接受。 */
  'accent-ghost': 'font-medium text-accent-700 hover:bg-accent-100 disabled:hover:bg-transparent',
  /* 警示色文字按钮（告警横幅里的「重试」）：同上，配色必须由变体给定。 */
  'warn-ghost': 'font-medium text-warn-700 hover:bg-warn-100 disabled:hover:bg-transparent',
  // 走 red-700 令牌而非 opacity：全站唯一用透明度表达 hover 的变体，
  // 与其余五个变体的「换一档底色」口径不一致。
  danger: 'bg-red-600 text-on-accent hover:bg-red-700 disabled:hover:bg-red-600',
  'danger-ghost': 'text-red-600 hover:bg-red-50 disabled:hover:bg-transparent',
  // 带边框的 soft：空态/引导块里的次级按钮需要可见边界，
  // 无边框的色块在浅色背景上分不清是按钮还是提示条。
  'soft-outline':
    'border border-accent-300 bg-accent-50 font-medium text-accent-700 hover:bg-accent-100 disabled:hover:bg-accent-50'
};

/**
 * 尺寸刻度：dense(11px) / xs(10px) / sm(14px) / md(14px)。
 *
 * `dense` 与 `xs` 的差别只在字号：11px 是项目自订的「正文说明」下限
 * （见 main.css 顶部的字号刻度），10px 只给徽角/图标内文。此前需要 11px 的
 * 调用点（侧栏 Tip、引导弹窗）只能在 className 里补 `text-3xs` 去压 xs 的
 * `text-2xs` —— 同为 utilities 层，胜负取决于产出顺序，不该由调用点承担。
 */
const BUTTON_SIZES = {
  dense: 'min-h-6 px-2 py-1 text-3xs',
  xs: 'min-h-6 px-2 py-1 text-2xs',
  sm: 'min-h-6 px-2 py-1 text-sm',
  md: 'min-h-8 px-3 py-1 text-sm'
} as const;

/**
 * 统一按钮（弹窗/表单/工具条共用）。
 * 统一按钮变体，业务代码不写原子类。
 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  disabled,
  label,
  tooltip,
  onClick,
  children
}: {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  type?: 'button' | 'submit';
  className?: string;
  disabled?: boolean;
  /**
   * 可访问名（icon-only 按钮必填）：落到 aria-label。
   * 有可见文字的按钮可以省略 —— 此时可访问名由 children 承担，
   * 传了 label 会以它为准（覆盖可见文字）。
   */
  label?: string;
  /** 鼠标提示需要比可访问名更长时用它（缺省回落 label）。 */
  tooltip?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={
        /* cursor-pointer：Tailwind v4 preflight 不再为按钮默认提供手型光标，须显式声明 */
        'inline-flex items-center justify-center rounded transition-base cursor-pointer disabled:cursor-default disabled:opacity-50 ' +
        /* 高度下限：dense/xs/sm 24px / md 32px。原 sm 用 py-0.5 实测约 22px，
           低于 WCAG 2.5.8 的 24px 最小目标尺寸；dense 与 xs 只差字号，
           高度仍守 24px —— 复用统一按钮不该以牺牲最小点击区域为代价。 */
        BUTTON_SIZES[size] +
        ' ' +
        BUTTON_TONES[variant] +
        (className ? ' ' + className : '')
      }
      disabled={disabled}
      title={tooltip ?? label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
