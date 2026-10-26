/**
 * 浏览器级快捷键（`manifest.commands`）的**单一口径**。
 *
 * 为什么需要它：快捷键此前有两份硬编码 —— `wxt.config.ts` 的 manifest 声明与设置页 /
 * 关于页各写一份展示文案，且两处的 Mac 修饰键口径还不一致（一处 `⌃⇧F`、一处恒
 * `Ctrl Shift F`）。改了 `suggested_key` 而漏改界面，用户看到的说明就成了错的。
 *
 * 为什么不直接让 `wxt.config.ts` 引用本表：manifest 是构建期产物，`wxt.config.ts`
 * 里写的是字面量，无法在本文件里双向引用。故两边各存一份，由
 * `tests/config/commands-source.test.ts` 强制对齐 —— 复制是刻意的，漂移不是。
 *
 * `suggestedKey` 用 Chrome 的官方写法（manifest 字段值本身）；界面显示走
 * `commandKeyParts`（Mac 显示符号，其余保留原词）。
 *
 * `labelKey` 走 `core/snapshot/defaultNames` 之外的另一条纪律：它是**界面文案**
 * （不是落盘数据），必须进词典，故用属性名以 `Key` 结尾的常量表形态
 * （扫描器据此抽词，英文模式下不会露中文）。
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

/**
 * 把 `Ctrl+Shift+F` 拆成本平台的**分段**写法，供界面逐段渲染成按键块。
 *
 * 纯函数：平台判定由调用方传入（本层不碰 `navigator`），因此可测。
 */
export function commandKeyParts(suggestedKey: string, isMac: boolean): string[] {
  const parts = suggestedKey.split('+');
  if (!isMac) return parts;
  return parts.map((part) => MAC_KEY_GLYPHS[part] ?? part);
}

/** 拼成单行展示（设置页那一行整体放进一个按键块）。 */
export function formatCommandKeys(suggestedKey: string, isMac: boolean): string {
  return commandKeyParts(suggestedKey, isMac).join(isMac ? '' : '+');
}
