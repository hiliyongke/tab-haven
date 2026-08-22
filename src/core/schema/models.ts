import { z } from 'zod';

/**
 * 数据模型（zod schema 族）——所有持久化数据的唯一校验口径。
 *
 * 设计：数据带格式版本（key 后缀 v<n>），读取经 safeParse 校验，
 * 坏数据隔离（不扩散）由 DataRepository 统一处理。
 */

export const FixedFolderItemSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  favIconUrl: z.string().optional(),
  /** 挂起条目：组内新建后等待真实导航的标签 id。 */
  pendingTabId: z.number().int().optional(),
  createdAt: z.number()
});
export type FixedFolderItem = z.infer<typeof FixedFolderItemSchema>;

export const FixedFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  collapsed: z.boolean(),
  items: z.array(FixedFolderItemSchema)
});
export type FixedFolder = z.infer<typeof FixedFolderSchema>;

export const PersistentPinSchema = z.object({
  id: z.string(),
  /** 身份标识（主机名归一化，见 core/fixed/PinIdentity）。 */
  identity: z.string(),
  url: z.string(),
  title: z.string(),
  favIconUrl: z.string().optional()
});
export type PersistentPin = z.infer<typeof PersistentPinSchema>;

export const SiteCollapseSchema = z.array(z.string());
export type SiteCollapseState = z.infer<typeof SiteCollapseSchema>;

/**
 * 设置项分类（仅用于 UI 分组，不参与校验）：
 *   appearance   外观与布局
 *   behavior     交互行为
 *   capabilities 进阶能力开关
 */
export const SettingsSchema = z.object({
  themePreference: z.enum(['system', 'light', 'dark']),
  language: z.string().optional(),
  aggregationThreshold: z.number().int().min(2).max(5),
  /** 标签顺序双向同步：侧边栏拖拽重排写回原生顺序，原生改动反向同步。 */
  tabOrderSync: z.boolean(),

  // —— 外观 appearance ——
  /** 顶部固定磁贴条（固定空间）显示开关。 */
  showPinnedStrip: z.boolean().default(true),
  /** 列表密度：compact 紧凑 / cozy 宽松。 */
  density: z.enum(['compact', 'cozy']).default('compact'),
  /** 标签行标题下方显示完整网址。 */
  showUrl: z.boolean().default(false),
  /** 处于浏览器分屏的标签显示「拆 / 伴」标记。 */
  showSplitBadges: z.boolean().default(true),

  // —— 行为 behavior ——
  /** 切换标签时把当前激活标签滚动进可视区。 */
  autoScrollActive: z.boolean().default(true),
  /** 标签行上按鼠标中键关闭该标签。 */
  closeOnMiddleClick: z.boolean().default(true),
  /** 临时区排序：browser 浏览器原生顺序 / recency 最近访问优先。 */
  sortMode: z.enum(['browser', 'recency']).default('browser'),

  // —— 能力 capabilities ——
  /** 自动休眠：超过等待时长未访问的非激活标签自动冻结释放内存。 */
  autoDiscardEnabled: z.boolean().default(false),
  /** 自动休眠等待时长（分钟），5–240。 */
  autoDiscardMinutes: z.number().int().min(5).max(240).default(30),
  /** 标签预览：悬停时按需截取激活标签缩略图（captureVisibleTab），默认关闭以保护页面隐私。 */
  previewEnabled: z.boolean().default(false),
  /** 临时区非固定标签聚合模式：site 按网站 / opener 按来源树 / language 按语言。 */
  groupMode: z.enum(['site', 'opener', 'language']).default('site'),
  /** 自动创建浏览器原生标签组：把聚合结果写回 tabGroups（只创建、不自动解散）。 */
  autoGroupNative: z.boolean().default(false),
  /** 撤销栈深度（FIFO 淘汰上限）。 */
  undoStackLimit: z.number().int().min(5).max(50).default(10),
  /** 状态提示条显示时长（秒）。 */
  toastDurationSec: z.number().int().min(3).max(15).default(7),
  /** 清理重复标签时豁免固定标签。 */
  keepPinnedInCleanup: z.boolean().default(true),
  /** 标签行操作按钮常显（关闭则悬停显示）。 */
  rowActionsVisible: z.boolean().default(false),
  /** 搜索是否包含中文拼音首字母匹配。 */
  pinyinSearch: z.boolean().default(true),
  /** 撤销记录跨重启持久化（关闭后仅会话内可撤销）。 */
  persistUndo: z.boolean().default(true),
  /** 同一网址只保留一个标签：新开已存在则切到最近访问的既有标签，其余（含新建）关闭。 */
  uniqueUrlTabs: z.boolean().default(true)
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  themePreference: 'system',
  language: undefined,
  aggregationThreshold: 2,
  tabOrderSync: true,
  showPinnedStrip: true,
  density: 'compact',
  showUrl: false,
  showSplitBadges: true,
  autoScrollActive: true,
  closeOnMiddleClick: true,
  sortMode: 'browser',
  autoDiscardEnabled: false,
  autoDiscardMinutes: 30,
  previewEnabled: false,
  groupMode: 'site',
  autoGroupNative: false,
  undoStackLimit: 10,
  toastDurationSec: 7,
  keepPinnedInCleanup: true,
  rowActionsVisible: false,
  pinyinSearch: true,
  persistUndo: true,
  uniqueUrlTabs: true
};

/** 撤销栈条目（Phase 5 使用，先行定义以固定数据形态）。 */
export const UndoTabRecordSchema = z.object({
  url: z.string(),
  index: z.number(),
  pinned: z.boolean(),
  muted: z.boolean(),
  groupId: z.number(),
  /** 原组名（组已删除时按名重建）。 */
  groupName: z.string().optional()
});
export type UndoTabRecord = z.infer<typeof UndoTabRecordSchema>;

export const UndoBatchSchema = z.object({
  id: z.string(),
  kind: z.string(),
  createdAt: z.number(),
  entries: z.array(UndoTabRecordSchema)
});
export type UndoBatch = z.infer<typeof UndoBatchSchema>;

/** 导出文件格式（FR-D9.1）。 */
export const ExportFileSchema = z.object({
  format: z.literal('tabhaven.export'),
  formatVersion: z.literal(1),
  exportedAt: z.string(),
  fixedFolders: z.array(FixedFolderSchema),
  persistentPins: z.array(PersistentPinSchema),
  siteCollapse: SiteCollapseSchema,
  settings: SettingsSchema
});
export type ExportFile = z.infer<typeof ExportFileSchema>;
