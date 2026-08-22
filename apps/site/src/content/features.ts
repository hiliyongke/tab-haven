/**
 * 功能卡片（10 张）。
 *
 * 全部对应 `README.md`「功能一览（v1.0）」里已实现的能力，不写规划中的东西。
 *
 * 字段后缀 Key 不是命名癖好：`i18n-kit` 的常量表通道只认「属性名以 Key 结尾」
 * 的对象字面量（`packages/i18n-kit/src/collect.ts:352`），写成 `title: '中文'`
 * 扫不进词典，英文站就会露中文。
 */
export type FeatureIcon =
  | 'grid'
  | 'folder'
  | 'search'
  | 'drag'
  | 'undo'
  | 'camera'
  | 'snowflake'
  | 'insight'
  | 'zap'
  | 'shield';

export interface FeatureItem {
  icon: FeatureIcon;
  titleKey: string;
  descKey: string;
}

export const FEATURES: readonly FeatureItem[] = [
  {
    icon: 'grid',
    titleKey: '按站点自动聚合',
    descKey:
      '同域名的标签自动聚合成组，可选同步为 Chrome 原生标签组；分组头带 n× 计数、静音与分屏徽章。'
  },
  {
    icon: 'folder',
    titleKey: '收藏夹与常驻磁贴',
    descKey:
      '文件夹支持拖放排序、挂起转正、一键打开全部、导出为书签；常驻磁贴留给每天都回来的页面。'
  },
  {
    icon: 'search',
    titleKey: '模糊搜索与键盘流',
    descKey: '标题、网址、拼音首字母都能搜，命中高亮；方向键与回车全程可操作，命令面板一键漫游。'
  },
  {
    icon: 'drag',
    titleKey: '拖拽整理',
    descKey: '标签、磁贴、分组头、文件夹条目都能拖着排；拖进文件夹时重复网址自动去重。'
  },
  {
    icon: 'undo',
    titleKey: '多层撤销',
    descKey: '关错了也能一层层撤回来（栈深 10），撤销历史面板还能找回浏览器最近关闭的标签与窗口。'
  },
  {
    icon: 'camera',
    titleKey: '会话快照与归档',
    descKey:
      '关窗自动留档；恢复前先给出「将新建 / 已存在 / 跳过」的对照预览，可勾选部分条目再恢复。'
  },
  {
    icon: 'snowflake',
    titleKey: '重复治理与休眠',
    descKey: '一键清理重复标签（保留你正在用的那个）；不看的标签休眠释放内存，需要时一键全部唤醒。'
  },
  {
    icon: 'insight',
    titleKey: '标签习惯洞察',
    descKey: '重复重灾区、休眠候选、7 天滞留预警，全部在本机计算，三类洞察都能一键直达对应动作。'
  },
  {
    icon: 'zap',
    titleKey: '快捷入口',
    descKey: '右键菜单、地址栏输入 t、工具栏角标与四组快捷键，从任何位置一步到达。'
  },
  {
    icon: 'shield',
    titleKey: '数据主权',
    descKey:
      '完整备份导出导入（导入失败整体回滚），权限逐条写明用途，零网络请求可自行用 DevTools 验证。'
  }
];
