import { z } from 'zod';
import {
  NO_CACHE_PATTERNS_LIMIT,
  NO_CACHE_PATTERN_MAX_LENGTH,
  normalizeNoCachePattern
} from '@/core/nocache/noCachePattern';

/**
 * 数据模型（zod schema 族）——所有持久化数据的唯一校验口径。
 *
 * 设计：数据带格式版本（key 后缀 v<n>），读取经 safeParse 校验，
 * 坏数据隔离（不扩散）由 DataRepository 统一处理。
 *
 * 所有集合与字符串都有**显式体积上限**。持久化数据有两个来源：用户操作与
 * 导入的备份文件——后者可被任意构造。无上限的数组会让「导入一个 JSON」
 * 变成内存与遍历成本的攻击面（例如 `isWhitelisted` 对每个标签 O(n) 遍历白名单，
 * 超大 whitelist 会放大自动休眠的每次判定）。上限取远超正常使用规模的值，
 * 只拦异常数据，不影响正常用户。
 */

/** 单文件夹条目数上限。 */
export const FOLDER_ITEMS_LIMIT = 500;
/** 固定文件夹数量上限。 */
export const FOLDERS_LIMIT = 200;
/** 永久固定图标数量上限。 */
export const PINS_LIMIT = 200;
/** 折叠站点记录条数上限。 */
export const SITE_COLLAPSE_LIMIT = 2_000;
/** 休眠白名单条目上限。 */
export const DISCARD_WHITELIST_LIMIT = 500;
/** hostname / 域名字符串长度上限（DNS 标签总长上限 253）。 */
export const HOST_MAX_LENGTH = 253;
/** 单个撤销批次的标签条目上限。 */
export const UNDO_BATCH_ENTRIES_LIMIT = 1_000;
/** 单个快照的标签数上限。 */
export const SNAPSHOT_TABS_LIMIT = 1_000;
/** 快照族总条数上限（含归档与自动快照）。 */
export const SNAPSHOTS_LIMIT = 200;

export const FixedFolderItemSchema = z.object({
  id: z.string(),
  url: z.string().optional(),
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
  items: z.array(FixedFolderItemSchema).max(FOLDER_ITEMS_LIMIT)
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

export const SiteCollapseSchema = z.array(z.string().max(HOST_MAX_LENGTH)).max(SITE_COLLAPSE_LIMIT);
export type SiteCollapseState = z.infer<typeof SiteCollapseSchema>;

/**
 * 设置项分类（仅用于 UI 分组，不参与校验）：
 *   appearance   外观与布局
 *   behavior     交互行为
 *   capabilities 进阶能力开关
 */
export const SettingsSchema = z.object({
  themePreference: z.enum(['system', 'light', 'dark']).default('system'),
  /** 主题色预设：plain 纯净（默认，无底色跟随 Chrome 明暗）/ forest 石墨绿 / ocean 雾霾蓝 / violet 暮山紫 / sunset 暖阳橙 / mono 中性灰。 */
  colorTheme: z.enum(['forest', 'ocean', 'violet', 'sunset', 'mono', 'plain']).default('plain'),
  /** 语言覆盖（BCP-47）。宽松校验兼容旧数据，仅约束长度与格式。 */
  language: z.string().min(2).max(32).optional(),
  /** 网站聚合阈值：同域名标签达到该数量自动成组。1 = 只要有标签就成组（单标签也分组）。 */
  aggregationThreshold: z.number().int().min(1).max(5).default(2),
  /** 标签顺序双向同步：侧边栏拖拽重排写回原生顺序，原生改动反向同步。 */
  tabOrderSync: z.boolean().default(true),

  // —— 外观 appearance ——
  /** 顶部固定磁贴条（固定空间）显示开关。 */
  showPinnedStrip: z.boolean().default(true),
  /** 顶部固定磁贴尺寸：sm 紧凑 / md 标准 / lg 大磁贴。 */
  pinnedStripSize: z.enum(['sm', 'md', 'lg']).default('md'),
  /** 列表密度：compact 紧凑 / cozy 宽松。 */
  density: z.enum(['compact', 'cozy']).default('cozy'),
  /** 标签行标题下方显示完整网址。 */
  showUrl: z.boolean().default(false),
  /** 底部工具区可选文字模式：开启后图标旁显示功能名称（默认仅图标 + 悬停提示）。 */
  footerLabels: z.boolean().default(false),
  /** 处于浏览器分屏的标签显示「拆 / 伴」标记。 */
  showSplitBadges: z.boolean().default(true),
  /** 站点组强调色：auto 按域名/favicon 自动配色 / mono 统一中性色。 */
  groupAccentStyle: z.enum(['auto', 'mono']).default('auto'),

  // —— 行为 behavior ——
  /** 切换标签时把当前激活标签滚动进可视区。 */
  autoScrollActive: z.boolean().default(true),
  /** 标签行上按鼠标中键关闭该标签。 */
  closeOnMiddleClick: z.boolean().default(true),
  /** 新建标签位置：end 窗口末尾 / after-active 当前激活标签之后。 */
  newTabPosition: z.enum(['end', 'after-active']).default('end'),
  /** 临时区排序：browser 浏览器原生顺序 / recency 最近访问优先。 */
  sortMode: z.enum(['browser', 'recency']).default('browser'),

  // —— 能力 capabilities ——
  /** 自动休眠：超过等待时长未访问的非激活标签自动冻结释放内存。 */
  autoDiscardEnabled: z.boolean().default(false),
  /** 自动休眠等待时长（分钟），5–240。 */
  autoDiscardMinutes: z.number().int().min(5).max(240).default(30),
  /** 临时区非固定标签聚合模式：site 按网站 / opener 按来源树 / language 按语言。 */
  groupMode: z.enum(['site', 'opener', 'language']).default('site'),
  /** 自动创建浏览器原生标签组：把聚合结果写回 tabGroups；关闭开关会解散本功能创建的组。 */
  autoGroupNative: z.boolean().default(false),
  /** 工具栏图标点击行为：panel 打开侧边栏（默认）/ regroup 后台整理临时区标签，不弹面板。 */
  actionClickMode: z.enum(['panel', 'regroup']).default('panel'),
  /** 撤销栈深度（FIFO 淘汰上限）。 */
  undoStackLimit: z.number().int().min(5).max(50).default(10),
  /**
   * 关窗自动保存：窗口关闭时自动存为快照（画像二生死线兜底）。
   * 默认关闭（PRD FR-D5.2 / 原则 8：自动化能力不默认接管用户数据）。
   * 注意：默认值只作用于新装用户，已存设置的用户读的是自己的存储值。
   */
  autoSaveSnapshots: z.boolean().default(false),
  /** 定时自动快照间隔（分钟），仅在 autoSaveSnapshots 开启时生效；5–720。 */
  autoSnapshotIntervalMin: z.number().int().min(5).max(720).default(30),
  /** 自动快照最大保留数（超出淘汰最旧）。 */
  maxAutoSnapshots: z.number().int().min(1).max(50).default(10),
  /** 命名快照最大保留数（防存储膨胀）。 */
  snapshotLimit: z.number().int().min(1).max(100).default(30),
  /** 状态提示条显示时长（秒）。 */
  toastDurationSec: z.number().int().min(3).max(15).default(7),
  /** 标签行操作按钮常显（关闭则悬停显示）。 */
  rowActionsVisible: z.boolean().default(false),
  /** 搜索是否包含中文拼音首字母匹配。 */
  pinyinSearch: z.boolean().default(true),
  /** 撤销记录跨重启持久化（关闭后仅会话内可撤销）。 */
  persistUndo: z.boolean().default(true),
  /** 同一网址只保留一个标签：新开已存在则切到最近访问的既有标签，其余（含新建）关闭。 */
  uniqueUrlTabs: z.boolean().default(true),
  /**
   * 自动休眠白名单：这些域名（hostname）永不被自动休眠（手动休眠不受限）。
   * 字符串按 hostname 长度封顶，条数另行限制——`isWhitelisted` 对每个标签
   * O(n) 遍历此列表，无上限会放大每次休眠判定。
   */
  discardWhitelist: z
    .array(z.string().max(HOST_MAX_LENGTH))
    .max(DISCARD_WHITELIST_LIMIT)
    .default([]),
  /** 搜索范围扩展到所有窗口（默认仅当前窗口，尊重「只管当前窗口」原则）。 */
  searchAllWindows: z.boolean().default(false),
  /** 自动休眠完成时的系统通知（通知面板内始终有「全部唤醒」可撤销）。 */
  discardNotifyEnabled: z.boolean().default(true),
  /** 重复标签自动合并（同网址唯一化）时的状态提示。 */
  reuseNotifyEnabled: z.boolean().default(true),
  /** 工具栏角标模式：auto 有重复显重复数/否则显标签数 / count 恒显标签数 / dups 恒显重复组数 / off 关闭。 */
  badgeMode: z.enum(['auto', 'count', 'dups', 'off']).default('auto'),
  /** 右键菜单（页面/链接/标签栏/工具栏图标）总开关。 */
  contextMenusEnabled: z.boolean().default(true) /** 地址栏命令（th <关键词>）总开关。 */,
  omniboxEnabled: z.boolean().default(true),
  /** 开发者：指定站点禁用前端缓存（DNR 响应头强制 no-store；需网站访问权限）。 */
  noCacheEnabled: z.boolean().default(false),
  /**
   * 禁缓存站点列表：纯域名（含子域）/ 域名+路径前缀 / 完整 URL 前缀，三种形态。
   *
   * 归一化必须在 schema 层完成（而非只在 UI 编辑器）：这些字符串最终会被编译成
   * DNR 动态规则的 urlFilter / regexFilter，而备份导入与设置同步同样经过本 schema。
   * 非法项（含 DNR 通配/锚定语法）在此丢弃，使「能读出的 pattern」恒等于
   * 「可安全编译的 pattern」。
   */
  noCachePatterns: z
    .array(z.string().min(1).max(NO_CACHE_PATTERN_MAX_LENGTH))
    .max(NO_CACHE_PATTERNS_LIMIT)
    .default([])
    .transform((patterns) =>
      patterns.map(normalizeNoCachePattern).filter((pattern): pattern is string => pattern !== null)
    ),
  /** 命中禁缓存站点时在页面顶部显示醒目警示条。 */
  noCacheBannerEnabled: z.boolean().default(true),
  /** 首启引导是否已看过（仅首次展示交互式引导）。 */
  onboarded: z.boolean().default(false),
  /** 侧边栏一次性「能力发现」Tip 是否已看过（仅首次展示）。 */
  tipSeen: z.boolean().default(false),
  /** 固定空间空态「概念一览」是否已隐藏（用户点过「不再显示」）。 */
  conceptsSeen: z.boolean().default(false),
  /**
   * 是否把固定集合与设置镜像到浏览器账号同步通道（chrome.storage.sync）。
   *
   * **默认关闭**。开启后这些数据会经由浏览器厂商的同步通道离开本机——
   * 与「本地优先」的定位相悖，且此前无任何开关、用户完全无感知。
   * 关闭时 `dataStore` 不调度镜像，并在关闭动作发生时清除已上传的镜像。
   */
  syncMirrorEnabled: z.boolean().default(false)
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  themePreference: 'system',
  colorTheme: 'plain',
  language: undefined,
  aggregationThreshold: 2,
  tabOrderSync: true,
  showPinnedStrip: true,
  pinnedStripSize: 'md',
  density: 'cozy',
  showUrl: false,
  footerLabels: false,
  showSplitBadges: true,
  groupAccentStyle: 'auto',
  autoScrollActive: true,
  closeOnMiddleClick: true,
  newTabPosition: 'end',
  sortMode: 'browser',
  autoDiscardEnabled: false,
  autoDiscardMinutes: 30,
  groupMode: 'site',
  autoGroupNative: false,
  actionClickMode: 'panel',
  undoStackLimit: 10,
  autoSaveSnapshots: false,
  autoSnapshotIntervalMin: 30,
  maxAutoSnapshots: 10,
  snapshotLimit: 30,
  toastDurationSec: 7,
  rowActionsVisible: false,
  pinyinSearch: true,
  persistUndo: true,
  uniqueUrlTabs: true,
  discardWhitelist: [],
  searchAllWindows: false,
  discardNotifyEnabled: true,
  reuseNotifyEnabled: true,
  badgeMode: 'auto',
  contextMenusEnabled: true,
  omniboxEnabled: true,
  noCacheEnabled: false,
  noCachePatterns: [],
  noCacheBannerEnabled: true,
  onboarded: false,
  tipSeen: false,
  conceptsSeen: false,
  syncMirrorEnabled: false
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
  entries: z.array(UndoTabRecordSchema).max(UNDO_BATCH_ENTRIES_LIMIT)
});
export type UndoBatch = z.infer<typeof UndoBatchSchema>;

/** 自动休眠批次台账：SW 自动休眠后记录，UI 据此提供「全部唤醒」撤销。 */
export const AutoDiscardBatchSchema = z
  .object({
    tabIds: z.array(z.number().int()).max(UNDO_BATCH_ENTRIES_LIMIT),
    at: z.number(),
    count: z.number().int()
  })
  // count 与 tabIds.length 冗余，入库时锁定一致性，防脏数据带偏消费方。
  .refine((batch) => batch.count === batch.tabIds.length, {
    message: 'count must equal tabIds.length'
  });
export type AutoDiscardBatch = z.infer<typeof AutoDiscardBatchSchema>;

/** 快照内单条标签（轻量，仅恢复所需字段）。 */
export const SnapshotTabSchema = z.object({
  url: z.string(),
  title: z.string().default(''),
  favIconUrl: z.string().optional(),
  pinned: z.boolean().default(false),
  /** 静音状态（恢复时还原；旧快照缺省为 false）。 */
  muted: z.boolean().default(false),
  /** 快照时所在原生组标题（未分组/旧快照缺省；恢复时按名并入或重建）。 */
  groupTitle: z.string().optional(),
  /** 快照时所在原生组颜色（Chrome 色名字符串，重建组时还原）。 */
  groupColor: z.string().optional()
});
export type SnapshotTab = z.infer<typeof SnapshotTabSchema>;

/** 会话快照（命名快照 + 关窗自动保存），本地优先、零账号。 */
export const SnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** manual 用户手动命名 / auto 关窗自动保存 / archive 归档中心（关闭但留档）/ space 轻量空间（复用快照）。 */
  origin: z.enum(['manual', 'auto', 'archive', 'space']),
  createdAt: z.number(),
  windowId: z.number().optional(),
  tabCount: z.number().int().nonnegative(),
  tabs: z.array(SnapshotTabSchema).max(SNAPSHOT_TABS_LIMIT)
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * 导出文件格式版本号。
 *
 * 必须在**第一个公开版本**就带上：格式一旦发布且无版本号，后续每次加字段都只能靠
 * 「猜字段是否存在」来兼容，迁移逻辑会随版本数指数膨胀。带版本号后，导入端可以
 * 先读 version 再分发到对应 schema，老备份走显式迁移路径。
 *
 * 演进方式：新增 version 常量 → 保留旧结构为 `ExportFileV{n}Schema` →
 * `parseExportFile` 按 version 分发并把旧结构升到最新结构。
 */
export const EXPORT_FILE_VERSION = 1;

/**
 * 导出文件格式。
 *
 * 完整备份 = 固定空间 + 固定图标 + 折叠态 + 设置 + 全部快照族
 * （manual 命名快照 / auto 关窗自动 / archive 归档 / space 轻量空间）。
 *
 * `version` 缺省时按 1 处理（容错未带版本号的早期备份）；
 * 未来版本会被字面量拒绝 —— 旧版扩展不认识新版数据结构，
 * 宁可提示用户升级，也不能让旧代码误读新字段。
 */
export const ExportFileSchema = z.object({
  format: z.literal('tabs.export'),
  version: z.literal(EXPORT_FILE_VERSION).default(EXPORT_FILE_VERSION),
  exportedAt: z.string(),
  fixedFolders: z.array(FixedFolderSchema).max(FOLDERS_LIMIT),
  persistentPins: z.array(PersistentPinSchema).max(PINS_LIMIT),
  siteCollapse: SiteCollapseSchema,
  settings: SettingsSchema,
  /** 快照族：manual 命名快照 / auto 关窗自动 / archive 归档 / space 轻量空间。 */
  snapshots: z.array(SnapshotSchema).max(SNAPSHOTS_LIMIT).default([])
});

export type ExportFile = z.infer<typeof ExportFileSchema>;

/**
 * 导出文件统一读取口径：单一格式，不匹配即拒绝（不静默降级）。
 * 当前只识别 `EXPORT_FILE_VERSION`；版本不同即拒绝，避免跨版本数据被误读。
 */
export function parseExportFile(
  raw: unknown
): { success: true; data: ExportFile } | { success: false } {
  const parsed = ExportFileSchema.safeParse(raw);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}
