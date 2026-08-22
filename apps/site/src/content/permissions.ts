/**
 * 权限逐条说明（13 项）。
 *
 * 与 `wxt.config.ts` 的 permissions（12 项）+ optional_host_permissions 一一对应，
 * 用途口径取自 `CHROMEWEBSTORE.md`「Permissions Justification」的中文版
 * （那份与 `PRIVACY.md` 第 2 节同口径，由 `pnpm check:privacy` 保证不漂移）。
 */
export interface PermissionRow {
  /** 权限名：标识符，各语言一致，不进词典 */
  name: string;
  /** 可选权限（默认不授予，按需由浏览器询问） */
  optional?: boolean;
  purposeKey: string;
}

export const PERMISSIONS: readonly PermissionRow[] = [
  {
    name: 'tabs',
    purposeKey: '在侧边栏列出并管理当前窗口的标签：切换、关闭、休眠、排序。不读取浏览历史。'
  },
  { name: 'tabGroups', purposeKey: '识别并同步 Chrome 原生标签组，解散时只清理本扩展创建的组。' },
  {
    name: 'storage',
    purposeKey: '把文件夹、常驻磁贴、快照与设置保存在本机，离线可用，卸载即清除。'
  },
  { name: 'alarms', purposeKey: '仅在开启自动休眠或定时快照后按周期检查标签状态，两项默认关闭。' },
  {
    name: 'contextMenus',
    purposeKey: '在网页、链接、标签栏与工具栏图标的右键菜单里提供快捷操作。'
  },
  { name: 'omnibox', purposeKey: '在地址栏输入 t 加关键词，直接搜索已打开的标签与收藏条目。' },
  { name: 'sessions', purposeKey: '在撤销历史面板显示浏览器最近关闭的标签与窗口，供一键恢复。' },
  { name: 'bookmarks', purposeKey: '仅在你主动点击时使用：把文件夹导出为书签，或从书签栏导入。' },
  { name: 'notifications', purposeKey: '自动休眠等后台动作执行后，在本机弹出一次系统通知。' },
  { name: 'favicon', purposeKey: '读取浏览器自己的本地站点图标库，不向你访问的站点发起任何请求。' },
  { name: 'sidePanel', purposeKey: '在浏览器侧边栏展示主界面 —— 这是本扩展的默认形态。' },
  {
    name: 'declarativeNetRequest',
    purposeKey: '供可选的「指定站点禁缓存」改写该站点响应头，不拦截请求、不读取页面内容。'
  },
  {
    name: '<all_urls>',
    optional: true,
    purposeKey: '默认不授予。仅当你开启「禁缓存」时由浏览器弹窗询问，可随时在扩展详情页收回。'
  }
];
