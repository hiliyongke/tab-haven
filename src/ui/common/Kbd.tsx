import type { ReactNode } from 'react';

/**
 * 键帽：设置页与关于页共用一套快捷键视觉。
 *
 * 此前设置页把「Ctrl+Shift+F」当裸文本渲染（窄列里会从 `+` 处断行），
 * 关于页另写一份 `<kbd>` 内联样式 —— 同一信息两套视觉语言，且尺寸会各自漂移。
 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-2xs leading-none text-gray-600">
      {children}
    </kbd>
  );
}
