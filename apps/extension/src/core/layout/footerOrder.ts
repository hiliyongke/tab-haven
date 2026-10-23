/**
 * 底栏按钮的顺序口径（纯领域计算，零浏览器/React 依赖）。
 *
 * 归到 core 的理由：顺序的「补全与去重」是数据与默认值之间的纯函数关系，
 * 且持久化值来自 `settings.footerOrder`（schema 层），与渲染无关。埋在组件里时
 * 既无法单测，也让「新增按钮后老用户的自定义顺序如何补全」这条规则藏在 JSX 旁。
 */

/**
 * 按钮 key 的默认顺序（= 按使用频率排列的推荐顺序）。
 *
 * 顺序原则：常驻的高频按钮固定在最左，条件出现的按钮（唤醒 / 清理重复 /
 * 洞察 / 关闭选中）集中在中段 —— 否则它们一出现就会把命令面板挤走，
 * 左端的肌肉记忆全废。低频项（重排 / 关于）与系统项（设置）靠右。
 */
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
