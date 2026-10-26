/**
 * 列表行 ↔ DOM 的约定（属性名与查询工具的唯一声明处）。
 *
 * 定位、脉冲高亮、键盘导航都要从「标签 id」找到「那一行 DOM」，而
 * `querySelector` 只吃字符串 —— 属性名一旦以字面量散落在写点与读点，
 * 重命名时 TypeScript 不会报错，定位与高亮静默失效（表现为「按了没反应」）。
 * 属性名与查询函数同处本文件，改名只需动这里。
 */

/** 临时区真实标签行（TabRow）携带的标签 id。 */
export const TAB_ROW_ID_ATTR = 'data-tabs-tab-id';
/** 固定区条目行（FolderItemRow）携带的绑定标签 id。 */
export const FOLDER_ITEM_ROW_ID_ATTR = 'data-folder-tab-id';
/** 可由键盘「回车激活」的行的标记（无值属性，存在即可激活）。 */
export const ROW_ACTIVATABLE_ATTR = 'data-row-activate';

/**
 * JSX 侧的挂载 props（与上面的查询函数同源）。
 *
 * React 不支持动态属性名写法，若不走这里就得把属性名以字面量再写一遍 ——
 * 那正是本文件要消灭的分叉。JSX 里写 `{...tabRowIdProps(tab.id)}`。
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
 *
 * 与 `findTabRow` 分开是一条硬性约束：两条路径共用属性会让 querySelector 因 DOM
 * 顺序（固定区在列表之前）永远先命中条目，列表中的激活行反而滚不到。
 */
export const findFolderItemRow = (tabId: number): HTMLElement | null =>
  rowById(FOLDER_ITEM_ROW_ID_ATTR, tabId);

/** 取容器内所有可回车激活的行（按 DOM 顺序）。 */
export const findActivatableRows = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(`[${ROW_ACTIVATABLE_ATTR}]`));

/**
 * 高亮持续时间：必须与 `.is-located` 的 CSS 动画时长保持一致 ——
 * 改动画不改这里，高亮会提前消失；改这里不改动画，class 已摘而动画还在跑。
 */
const LOCATE_HIGHLIGHT_MS = 1200;

/** 视觉行元素：滚动锚点是 `<li>`，动画定义在内部 `.row-item` 上。 */
function visualRowOf(target: HTMLElement): HTMLElement {
  return target.querySelector<HTMLElement>('.row-item') ?? target;
}

/**
 * 重播一次定位脉冲（入口是行的锚点元素，内部自行解析视觉行）。
 *
 * 「先摘 class → 读一次 `offsetWidth` 强制同步布局 → 再挂回 class」是让同一个 CSS
 * 动画重新播放的唯一可靠手段：同一帧内 remove+add 会被浏览器合并，动画不会重启。
 * 这个强制重排的技巧在本仓只有这一份实现（`pulseTabRows` 与 `useLocateActive`
 * 共用），此前两处各写一遍，改一处必漏另一处。
 *
 * `timers` 用于把清理定时器交给调用方的生命周期管理（组件卸载时一并清掉）；
 * 不传表示无需跟踪（如一次性批量脉冲，元素上再挂一次 class 也无害）。
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
 * 给指定标签行播放一次定位脉冲（复用 `.is-located` 的既有动画）。
 *
 * 只查临时区（data-tabs-tab-id）：清理重复的保留项一定是临时区标签，
 * 固定区条目（data-folder-tab-id）不参与，避免同 id 命中到固定区去。
 * 用途：批量操作后高亮「被保留的项」（如清理重复后让用户看到每个域名留下了哪一个）。
 */
export function pulseTabRows(tabIds: readonly number[]): void {
  for (const tabId of tabIds) {
    const target = findTabRow(tabId);
    if (!target) continue;
    pulseRow(target);
  }
}
