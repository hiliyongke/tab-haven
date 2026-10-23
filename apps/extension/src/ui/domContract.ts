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
