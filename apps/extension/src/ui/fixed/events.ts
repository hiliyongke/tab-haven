/**
 * 固定空间相关的 window 自定义事件名。
 * 单独成文件切断循环依赖：FixedArea → FolderRow → FixedArea。
 */

/** 请求固定空间定位到某个标签（入口层派发，FolderRow 监听并展开所属文件夹）。 */
export const LOCATE_TAB_EVENT = 'tabs:locate-tab';
/** App 层请求固定空间弹出「新建文件夹」命名弹窗（拖标签/分组到空白区时触发）。 */
export const CREATE_FOLDER_REQUEST_EVENT = 'tabs:create-folder-request';
