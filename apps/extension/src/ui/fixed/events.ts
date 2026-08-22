/**
 * 固定空间相关的 window 自定义事件名。
 *
 * 单独成文件是为了切断循环依赖：`FixedArea` 持有着两个常量并渲染 `FolderRow`，
 * 而 `FolderRow` 又要监听定位事件 —— 反向 `import ... from './FixedArea'` 会形成
 * FixedArea → FolderRow → FixedArea 的环。事件名是纯常量，放在叶子模块最合适。
 */

/** 请求固定空间定位到某个标签（由入口层派发，FolderRow 监听并展开所属文件夹）。 */
export const LOCATE_TAB_EVENT = 'tabs:locate-tab';
/** App 层请求固定空间弹出「新建文件夹」命名弹窗（拖标签/分组到空白区时触发）。 */
export const CREATE_FOLDER_REQUEST_EVENT = 'tabs:create-folder-request';
