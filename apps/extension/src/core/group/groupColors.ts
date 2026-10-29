/**
 * 浏览器原生标签组的合法色名（单一来源）：schema 收严快照 groupColor、自动分组取色、
 * 组编辑弹窗列色板都用它，避免 schema 承认的色与 UI 能选的色分叉。
 */

/** 全部合法色名（含 grey）。 */
export const GROUP_COLOR_NAMES = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
] as const;

type GroupColorName = (typeof GROUP_COLOR_NAMES)[number];

/** 是否为浏览器合法组色（快照落盘前的收窄：非法值降级为缺省，而非让整条数据校验失败）。 */
export function toGroupColor(raw: string | undefined): GroupColorName | undefined {
  return (GROUP_COLOR_NAMES as readonly string[]).includes(raw ?? '')
    ? (raw as GroupColorName)
    : undefined;
}

/** 自动分组避开 grey（Chrome 默认色），让用户能区分手动建组与自动建组。 */
export const AUTO_GROUP_COLOR_NAMES = GROUP_COLOR_NAMES.filter(
  (name): name is Exclude<GroupColorName, 'grey'> => name !== 'grey'
);
