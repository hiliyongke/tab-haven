/**
 * 浏览器级快捷键（manifest.commands）的单一口径。wxt.config.ts 的 manifest 声明是
 * 构建期字面量，无法反向引用本表，两边各存一份，由 tests/config/commands-source.test.ts 强制对齐。
 * suggestedKey 是 manifest 原值，界面显示走 commandKeyParts（Mac 转符号）。
 * labelKey 是界面文案（非落盘数据），用 *Key 常量表形态供扫描器抽词。
 */

/** Mac 的修饰键符号映射（Chrome 自己的「扩展快捷键」页用的就是这套符号）。 */
const MAC_KEY_GLYPHS: Record<string, string> = {
  Ctrl: '⌃',
  Shift: '⇧',
  Alt: '⌥',
  Command: '⌘',
  MacCtrl: '⌃'
};

export const COMMANDS = [
  { id: 'focus-search', suggestedKey: 'Ctrl+Shift+F', labelKey: '聚焦搜索' },
  { id: 'open-panel', suggestedKey: 'Ctrl+Shift+O', labelKey: '打开 / 聚焦侧边栏' },
  { id: 'locate-active', suggestedKey: 'Ctrl+Shift+L', labelKey: '定位当前激活标签' },
  { id: 'discard-inactive', suggestedKey: 'Ctrl+Shift+U', labelKey: '休眠当前窗口的后台标签' }
] as const;

export type CommandSpec = (typeof COMMANDS)[number];

/** 把 `Ctrl+Shift+F` 拆成分段写法；平台由调用方传入（本层不碰 navigator），可测。 */
export function commandKeyParts(suggestedKey: string, isMac: boolean): string[] {
  const parts = suggestedKey.split('+');
  if (!isMac) return parts;
  return parts.map((part) => MAC_KEY_GLYPHS[part] ?? part);
}

/** 拼成单行展示（设置页那一行整体放进一个按键块）。 */
export function formatCommandKeys(suggestedKey: string, isMac: boolean): string {
  return commandKeyParts(suggestedKey, isMac).join(isMac ? '' : '+');
}
