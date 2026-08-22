/**
 * 快捷键与命令。
 *
 * 来源：`wxt.config.ts` 的 commands（四组 suggested_key）与 omnibox keyword `t`；
 * 命令面板的 ⌘/Ctrl+P 见 README 功能一览「快捷入口」。
 */
export interface ShortcutRow {
  /**
   * 按键字面量：组合键在两种语言下写法一致，**不进词典**（进了就变成「译文与原文
   * 相同」，会被 i18n-kit 判为伪翻译）。
   */
  keys?: string;
  /** 含文字描述的按键（如地址栏命令）：必须进词典，否则英文页会露中文 */
  keysKey?: string;
  descKey: string;
}

export const SHORTCUTS: readonly ShortcutRow[] = [
  { keys: 'Ctrl / ⌘ + Shift + F', descKey: '聚焦搜索框' },
  { keys: 'Ctrl / ⌘ + Shift + O', descKey: '打开侧边栏面板' },
  { keys: 'Ctrl / ⌘ + Shift + L', descKey: '定位当前标签' },
  { keys: 'Ctrl / ⌘ + Shift + U', descKey: '休眠所有非活跃标签' },
  { keys: 'Ctrl / ⌘ + P', descKey: '打开命令面板（命令、标签、文件夹三组漫游）' },
  { keysKey: '地址栏输入 t + 空格', descKey: '直达搜索标签、常驻磁贴与文件夹' }
];
