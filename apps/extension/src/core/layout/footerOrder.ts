/** 底栏按钮顺序与拖拽标识的领域定义。 */

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

export type FooterButtonId = `${typeof FOOTER_ID_PREFIX}${FooterButtonKey}`;

export const footerButtonId = (key: FooterButtonKey): FooterButtonId =>
  `${FOOTER_ID_PREFIX}${key}` as FooterButtonId;

export const FOOTER_BUTTON_IDS = FOOTER_BUTTON_KEYS.map(footerButtonId) as [
  FooterButtonId,
  ...FooterButtonId[]
];

export const footerButtonKeyFromId = (id: FooterButtonId): FooterButtonKey =>
  id.slice(FOOTER_ID_PREFIX.length) as FooterButtonKey;
