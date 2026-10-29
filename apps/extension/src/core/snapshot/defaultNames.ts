/**
 * 快照/文件夹的默认名是**落盘值**、会进导出备份，刻意不参与 i18n：按界面语言生成会让
 * 同一份数据在换语言后出现两种名字，破坏「同名合并」的导入语义。生成侧一律走本模块常量。
 */
// @i18n-ignore-start
export const DEFAULT_SNAPSHOT_NAMES = {
  manual: '新快照', // saveCurrentWindow
  space: '工作区', // saveSpace
  archive: '归档快照', // archiveCurrentWindow
  auto: '自动快照', // 关窗兜底 / 定时
  oneTab: 'OneTab 导入',
  workona: 'Workona 导入',
  regroup: '重排前现场' // 快速整理前保存的现场，显式传入，同样落盘
} as const;
// @i18n-ignore-end

/** 落盘用的默认文件夹/标签组名，同理不参与 i18n。 */
// @i18n-ignore-start
export const DEFAULT_FOLDER_NAMES = {
  untitled: '无标题标签',
  unnamedGroup: '未命名标签组'
} as const;
// @i18n-ignore-end
