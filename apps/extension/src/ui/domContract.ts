/**
 * 列表行 ↔ DOM 的约定（属性名与查询工具的唯一声明处）。
 *
 * 定位、脉冲高亮、键盘导航都要从「标签 id」找到「那一行 DOM」，而 `querySelector` 只吃字符串——
 * 属性名散落在写点与读点时，重命名 TypeScript 不会报错，定位与高亮静默失效（表现为「按了没反应」）。
 */

/** 临时区真实标签行（TabRow）携带的标签 id。 */
export const TAB_ROW_ID_ATTR = 'data-tabs-tab-id';
/** 固定区条目行（FolderItemRow）携带的绑定标签 id。 */
export const FOLDER_ITEM_ROW_ID_ATTR = 'data-folder-tab-id';
/** 可由键盘「回车激活」的行的标记（无值属性，存在即可激活）。 */
export const ROW_ACTIVATABLE_ATTR = 'data-row-activate';

/**
 * JSX 侧的挂载 props（与查询函数同源）。React 不支持动态属性名写法，
 * 不走这里就得把属性名字面量再写一遍——那正是本文件要消灭的分叉。JSX 里写 `{...tabRowIdProps(tab.id)}`。
 */
export const tabRowIdProps = (tabId: number): Record<string, number> => ({
  [TAB_ROW_ID_ATTR]: tabId
});
export const folderItemRowIdProps = (
  tabId: number | undefined
): Record<string, number | undefined> => ({
  [FOLDER_ITEM_ROW_ID_ATTR]: tabId
});
/** 常量对象：可回车激活的行（无值属性）。 */
export const activatableRowProps: Record<string, string> = { [ROW_ACTIVATABLE_ATTR]: '' };

/** 按属性名 + 标签 id 取行元素。 */
function rowById(attr: string, tabId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${attr}="${tabId}"]`);
}

/** 取临时区的标签行（清理重复后的保留项一定在此）。 */
export const findTabRow = (tabId: number): HTMLElement | null => rowById(TAB_ROW_ID_ATTR, tabId);

/**
 * 取绑定标签在固定区的条目行。
 * 与 `findTabRow` 分开是硬性约束：共用属性会让 querySelector 因 DOM 顺序
 * （固定区在列表之前）永远先命中条目，列表中的激活行反而滚不到。
 */
export const findFolderItemRow = (tabId: number): HTMLElement | null =>
  rowById(FOLDER_ITEM_ROW_ID_ATTR, tabId);

/** 取容器内所有可回车激活的行（按 DOM 顺序）。 */
export const findActivatableRows = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(`[${ROW_ACTIVATABLE_ATTR}]`));

/** 必须与 `.is-located` 的 CSS 动画时长一致：不一致会提前消失或 class 已摘而动画还在跑。 */
const LOCATE_HIGHLIGHT_MS = 1200;

/** 视觉行元素：滚动锚点是 `<li>`，动画定义在内部 `.row-item` 上。 */
function visualRowOf(target: HTMLElement): HTMLElement {
  return target.querySelector<HTMLElement>('.row-item') ?? target;
}

/**
 * 重播一次定位脉冲（入口是行锚点，内部自行解析视觉行）。
 *
 * 「先摘 class → 读一次 `offsetWidth` 强制同步布局 → 再挂回 class」是重播同一 CSS 动画的唯一可靠手段：
 * 同一帧内 remove+add 会被浏览器合并，动画不重启。`pulseTabRows` 与 `useLocateActive` 共用此实现。
 *
 * `timers` 把清理定时器交给调用方生命周期管理（卸载时一并清掉）；不传表示无需跟踪。
 */
export function pulseRow(target: HTMLElement, timers?: Set<number>): void {
  const row = visualRowOf(target);
  row.classList.remove('is-located');
  void row.offsetWidth;
  row.classList.add('is-located');
  const id = window.setTimeout(() => {
    row.classList.remove('is-located');
    timers?.delete(id);
  }, LOCATE_HIGHLIGHT_MS);
  timers?.add(id);
}

/**
 * 给指定标签行播放一次定位脉冲（复用 `.is-located` 动画）。
 * 只查临时区：清理重复的保留项一定是临时区标签，避免同 id 命中到固定区。
 */
export function pulseTabRows(tabIds: readonly number[]): void {
  for (const tabId of tabIds) {
    const target = findTabRow(tabId);
    if (!target) continue;
    pulseRow(target);
  }
}
