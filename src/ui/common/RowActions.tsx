import type { ReactNode } from 'react';

/**
 * 行尾操作容器：默认悬停/聚焦时从 0 宽度展开（与行 hover 状态联动）；
 * forceVisible 时常显（设置「操作按钮常显」）。
 * TabRow 与固定条目行共用同一展开逻辑，此前为逐字相同的长 className。
 */
export function RowActions({
  children,
  forceVisible = false
}: {
  children: ReactNode;
  /** 常显操作按钮（否则仅悬停/聚焦时展开）。 */
  forceVisible?: boolean;
}) {
  return (
    <span
      className={
        'flex shrink-0 items-center gap-0.5 overflow-hidden transition-all duration-150' +
        (forceVisible
          ? ' w-auto opacity-100'
          : ' w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100')
      }
    >
      {children}
    </span>
  );
}
