/**
 * 浏览器原生标签组的颜色枚举（Chrome `tabGroups` 的合法色名）。
 *
 * 单一来源：`core/schema` 用它收严快照里的 `groupColor`、自动分组从这里取色、
 * 组编辑弹窗从这里列色板。三处各写一份时（弹窗版还会多出一个 grey），
 * 任一处增删色号都会让「schema 承认的色」与「UI 能选的色」分叉。
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

export type GroupColorName = (typeof GROUP_COLOR_NAMES)[number];

/** 是否为浏览器合法组色（快照落盘前的收窄：非法值降级为缺省，而非让整条数据校验失败）。 */
export function toGroupColor(raw: string | undefined): GroupColorName | undefined {
  return (GROUP_COLOR_NAMES as readonly string[]).includes(raw ?? '')
    ? (raw as GroupColorName)
    : undefined;
}

/**
 * 自动分组可用色（排除 grey）。
 *
 * grey 是 Chrome 新建组的默认色，留给「用户手动建组」，自动分组避开它 ——
 * 否则用户无法区分「这个组是我建的」还是「扩展自动建的」。
 */
export const AUTO_GROUP_COLOR_NAMES = GROUP_COLOR_NAMES.filter(
  (name): name is Exclude<GroupColorName, 'grey'> => name !== 'grey'
);
