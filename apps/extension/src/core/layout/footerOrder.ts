/** 底栏按钮的顺序口径（纯领域计算，零浏览器/React 依赖）：补全与去重是持久化值与默认值间的纯函数关系，故归 core 以便单测。 */

/** 按钮 key 的默认顺序（按使用频率）：高频常驻按钮在左、条件出现的集中中段（否则会把命令面板挤走）、低频与系统项靠右。 */
export const FOOTER_BUTTON_KEYS = [
  'palette',
  'locate',
  'collapseAll',
  'discard',
  'wake',
  'snapshot',
  'history',
  'cleanDuplicates',
  'insights',
  'closeHighlighted',
  'regroup',
  'about',
  'settings'
] as const;

export type FooterButtonKey = (typeof FOOTER_BUTTON_KEYS)[number];

/** 底栏按钮 id 前缀：与全局其它 sortable（tab: / folder: / pin:）隔离，避免 id 撞车。 */
export const FOOTER_ID_PREFIX = 'footer:';

export const footerButtonId = (key: FooterButtonKey): string => `${FOOTER_ID_PREFIX}${key}`;

/**
 * 把持久化的顺序补全成完整列表：过滤未知 id，缺失的按钮按其**默认相对顺序**
 * 追加到末尾。这样版本升级新增按钮时，老用户的自定义顺序不会让新按钮消失。
 */
export function normalizeFooterOrder(saved: readonly string[]): FooterButtonKey[] {
  const kept: FooterButtonKey[] = [];
  // 按 saved 的顺序取（不能按默认顺序 filter —— 那样用户的自定义顺序会被默认顺序覆盖）
  for (const id of saved) {
    const key = FOOTER_BUTTON_KEYS.find((candidate) => footerButtonId(candidate) === id);
    if (key && !kept.includes(key)) kept.push(key);
  }
  const missing = FOOTER_BUTTON_KEYS.filter((key) => !kept.includes(key));
  return [...kept, ...missing];
}
