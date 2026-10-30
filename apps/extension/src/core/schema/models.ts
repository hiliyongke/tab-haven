import { z } from 'zod';
import {
  NO_CACHE_PATTERNS_LIMIT,
  NO_CACHE_PATTERN_MAX_LENGTH,
  normalizeNoCachePattern
} from '@/core/nocache/noCachePattern';
import { COLOR_THEME_IDS } from '@/core/theme/colorThemes';
import { toGroupColor } from '@/core/group/groupColors';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import { normalizeHostname, normalizeWhitelistHost } from '@/core/url/hostname';
import { isHttpUrl } from '@/core/url/UrlInspector';
import { FOOTER_BUTTON_IDS, FOOTER_BUTTON_KEYS } from '@/core/layout/footerOrder';

/**
 * 数据模型（zod schema 族）——所有持久化数据的唯一校验口径。
 *
 * 数据带格式版本（key 后缀 v<n>），读取经 safeParse 校验，坏数据隔离由 DataRepository 处理。
 *
 * 体积上限只加在**外部输入侧**（导出 / 导入 / 同步镜像）：备份文件可被任意构造，无上限数组会让
 * 「导入一个 JSON」变成内存与遍历攻击面。落盘侧仓库 schema（platform/registry.ts）刻意**不带**
 * `.max()`——读盘收严会把存量超限用户的真实数据判坏而整表清空。落盘收敛由 store 裁剪完成
 * （见 stores/data/initSlice.ts）。自由文本同理不逐串限长，由 storage 配额天然封顶。
 *
 * 本文件只收「会进导出备份」的数据；会话态、同步镜像信封、诊断日志等落盘 schema 就近定义在各自
 * platform 模块（各自绑定存储键与读写口径，迁入反而割裂）。
 */

export const FOLDER_ITEMS_LIMIT = 500;
export const FOLDERS_LIMIT = 200;
export const PINS_LIMIT = 200;
export const SITE_COLLAPSE_LIMIT = 2_000;
const DISCARD_WHITELIST_LIMIT = 500;
/** DNS 主机名总长上限 253。 */
export const HOST_MAX_LENGTH = 253;
/** 仅作用于导入侧：运行时 favIconUrl 可能是大体积 data:image/，读盘封顶会误伤已写入的合法数据。 */
const FAVICON_URL_MAX_LENGTH = 2_048;
/** 单个撤销批次的标签条目上限。 */
export const UNDO_BATCH_ENTRIES_LIMIT = 1_000;
/** 撤销栈默认深度（schema 与 core 共用同一来源，避免上限双定义）。 */
export const DEFAULT_UNDO_STACK_LIMIT = 10;
/** 单个快照的标签数上限。 */
export const SNAPSHOT_TABS_LIMIT = 1_000;
/** 快照族总条数上限（含归档与自动快照）。 */
export const SNAPSHOTS_LIMIT = 200;

/** 超出部分截断而非判坏：标题非身份字段，超长不该让整份文件夹数组被判坏、把在意条目丢进隔离区。 */
export const FOLDER_ITEM_TITLE_MAX = 512;

export const FixedFolderItemSchema = z.object({
  id: z.string(),
  url: z.string().optional(),
  title: z.string().transform((value) => value.slice(0, FOLDER_ITEM_TITLE_MAX)),
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

/**
 * 常驻磁贴（顶部固定区里的一枚磁贴）。
 * 术语警告：`TabRecord.pinned`（浏览器原生「固定标签」）与本类型是**两回事**——磁贴是
 * 本产品持久化的资产，浏览器固定标签是标签条状态；`ui/fixed/` 下两类组件同时存在，勿混用。
 */
export const PersistentPinSchema = z.object({
  id: z.string(),
  /** 必须在 schema 层归一化：dedupePins 按 identity 判重，导入/镜像不经过 UI，未归一化的落盘值会让同站点磁贴永不合并。 */
  identity: z.string().max(HOST_MAX_LENGTH).transform(normalizeHostname),
  url: z.string(),
  title: z.string(),
  favIconUrl: z.string().optional()
});
export type PersistentPin = z.infer<typeof PersistentPinSchema>;

/** 折叠站点记录（hostname 集合）。归一化在 schema 层完成，否则备份里未归一化条目永不命中折叠态。 */
export const SiteCollapseSchema = z
  .array(z.string().max(HOST_MAX_LENGTH))
  .transform((hosts) => [
    ...new Set(hosts.map(normalizeHostname).filter((host) => host.length > 0))
  ])
  // 上限与去重必须在归一化之后：否则同一站点多种写法各占额度、重复项放大比对。
  .pipe(z.array(z.string()).max(SITE_COLLAPSE_LIMIT));
export type SiteCollapseState = z.infer<typeof SiteCollapseSchema>;

/** 聚合阈值默认值，schema 与纯函数（aggregateBySite / buildSitePlan）共用，避免两处默认值分叉。 */
export const DEFAULT_AGGREGATION_THRESHOLD = 2;

/**
 * 设置项分类（仅用于 UI 分组，不参与校验）：
 *   appearance   外观与布局
 *   behavior     交互行为
 *   capabilities 进阶能力开关
 */
export const SettingsSchema = z
  .object({
    themePreference: z.enum(['system', 'light', 'dark']).default('system'),
    /** 主题色预设（色号唯一来源 core/theme/colorThemes）：plain 默认无底色 / forest / ocean / violet / sunset / mono。 */
    colorTheme: z.enum(COLOR_THEME_IDS).default('plain'),
    /** 语言覆盖（BCP-47）。仅约束长度与格式。 */
    language: z.string().min(2).max(32).optional(),
    /** 网站聚合阈值：同域名标签达到该数量自动成组。1 = 只要有标签就成组（单标签也分组）。 */
    aggregationThreshold: z.number().int().min(1).max(5).default(DEFAULT_AGGREGATION_THRESHOLD),
    /** 标签顺序双向同步：侧边栏拖拽重排写回原生顺序，原生改动反向同步。 */
    tabOrderSync: z.boolean().default(true),

    // —— 外观 appearance ——
    /** 顶部常驻磁贴条（固定空间）显示开关。 */
    showPinnedStrip: z.boolean().default(true),
    /** 列表密度：tight 超紧凑 / compact 紧凑 / cozy 宽松 / large 大字号。tight 行高低于 24px 推荐尺寸，属「用可点面积换信息密度」的取舍。 */
    density: z.enum(['tight', 'compact', 'cozy', 'large']).default('cozy'),
    /** 标签行标题下方显示完整网址。 */
    showUrl: z.boolean().default(false),
    /** 底栏文字标签，新装默认开（窄面板自动退回纯图标）：仅图标 + 悬停提示会让新用户面对一排不可辨识的按钮。 */
    footerLabels: z.boolean().default(true),
    /** 底栏按钮顺序：必须包含所有已定义按钮且不重复。 */
    footerOrder: z
      .array(z.enum(FOOTER_BUTTON_IDS))
      .length(FOOTER_BUTTON_KEYS.length)
      .refine((ids) => new Set(ids).size === FOOTER_BUTTON_KEYS.length)
      .default([...FOOTER_BUTTON_IDS]),
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
    /** 自动休眠：超过等待时长未访问的后台标签自动休眠释放内存。 */
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
    undoStackLimit: z.number().int().min(5).max(50).default(DEFAULT_UNDO_STACK_LIMIT),
    /** 自动保存（关窗 + 定时快照）：默认开启，纯保护性能力（只保存、不改标签），容量由 maxAutoSnapshots 约束。默认值仅在存储尚无该键时生效。 */
    autoSaveSnapshots: z.boolean().default(true),
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
    /** 时间线搜索：搜索同时命中快照与归档条目。默认开启（快照已在本地、索引纯本地计算），索引量受 HISTORY_SNAPSHOT_LIMIT 约束不拖垮性能。 */
    searchHistory: z.boolean().default(true),
    /** 撤销记录跨重启持久化（关闭后仅会话内可撤销）。 */
    persistUndo: z.boolean().default(true),
    /** 同一网址只保留一个标签：新开已存在则切到最近访问的既有标签，其余（含新建）关闭。 */
    uniqueUrlTabs: z.boolean().default(true),
    /**
     * 自动休眠白名单：这些 hostname 永不被自动休眠（手动休眠不受限）。
     * 归一化必须在 schema 层：备份/镜像/直写 storage 都不经设置页，只在 UI 归一化会让落盘值与匹配端口径不一致（名单里有却仍被休眠）。
     */
    discardWhitelist: z
      .array(z.string().max(HOST_MAX_LENGTH))
      .default([])
      .transform((hosts) => [
        ...new Set(hosts.map(normalizeWhitelistHost).filter((host) => host.length > 0))
      ])
      // 上限与去重同样后置于归一化（同 SiteCollapseSchema）：否则同一站点多种写法各占额度。
      .pipe(z.array(z.string()).max(DISCARD_WHITELIST_LIMIT)),
    /** 搜索范围扩展到所有窗口（默认仅当前窗口，尊重「只管当前窗口」原则）。 */
    searchAllWindows: z.boolean().default(false),
    /** 自动休眠完成时的系统通知（通知面板内始终有「全部唤醒」可撤销）。 */
    discardNotifyEnabled: z.boolean().default(true),
    /** 重复标签自动合并（同网址唯一化）时的状态提示。 */
    reuseNotifyEnabled: z.boolean().default(true),
    /** 工具栏角标模式：auto 有重复显重复数/否则显标签数 / count 恒显标签数 / dups 恒显重复组数 / off 关闭。 */
    badgeMode: z.enum(['auto', 'count', 'dups', 'off']).default('auto'),
    /** 右键菜单（页面/链接/标签栏/工具栏图标）总开关。 */
    contextMenusEnabled: z.boolean().default(true),
    /** 地址栏命令（t <关键词>）总开关。 */
    omniboxEnabled: z.boolean().default(true),
    /** 开发者：指定站点禁用前端缓存（DNR 响应头强制 no-store；需网站访问权限）。 */
    noCacheEnabled: z.boolean().default(false),
    /**
     * 禁缓存站点列表：纯域名（含子域）/ 域名+路径前缀 / 完整 URL 前缀，三种形态。
     * 归一化必须在 schema 层完成：这些串会被编译成 DNR 动态规则，备份导入与同步同样经过本 schema；
     * 非法项（含 DNR 通配/锚定语法）在此丢弃，使「能读出的 pattern」恒等于「可安全编译的 pattern」。
     */
    noCachePatterns: z
      .array(z.string().min(1).max(NO_CACHE_PATTERN_MAX_LENGTH))
      .default([])
      // 同 SiteCollapseSchema / discardWhitelist：先归一化 + 去重，上限作用于归一化之后的值，
      // 否则 a.com 与 A.COM 各占一份额度、归一化后重复，编译出重复的 DNR 规则。
      .transform((patterns) => [
        ...new Set(
          patterns
            .map(normalizeNoCachePattern)
            .filter((pattern): pattern is string => pattern !== null)
        )
      ])
      .pipe(z.array(z.string()).max(NO_CACHE_PATTERNS_LIMIT)),
    /** 首启引导是否已看过（仅首次展示交互式引导）。 */
    onboarded: z.boolean().default(false),
    /** 侧边栏一次性「能力发现」Tip 是否已看过（仅首次展示）。 */
    tipSeen: z.boolean().default(false),
    /** 固定空间空态「概念一览」是否已隐藏（用户点过「不再显示」）。 */
    conceptsSeen: z.boolean().default(false),
    /** 是否把文件夹、磁贴与设置镜像到 chrome.storage.sync。默认关闭：数据会经浏览器厂商通道离开本机，与「本地优先」相悖，须显式开启；关闭时清除已上传镜像。 */
    syncMirrorEnabled: z.boolean().default(false),
    /** 当前激活的工作区（origin=space 快照的 id；缺省 = 未激活）。仅是 id 引用，删除后失效，消费方须按「找不到即视为未激活」容错。术语「工作区」≠「固定空间」（FixedArea），勿混用。 */
    activeSpaceId: z.string().optional(),
    /** 面板展示其他窗口的分段（只读 + 聚焦/关闭）。默认关闭（「只管理当前窗口」口径），与 searchAllWindows 一致。 */
    showOtherWindows: z.boolean().default(false)
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;

/** 列表密度档位（从 schema 派生，避免 UI 各处手写联合类型导致加档漏改）。 */
export type Density = Settings['density'];

/** 由 SettingsSchema 派生（手抄会让加设置忘改默认值静默损坏数据）。每个字段都必须带 .default()，否则 parse({}) 在加载期抛错、所有入口导入即崩溃；新增字段务必补 .default()。 */
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** 撤销栈条目：恢复标签所需的最小五元组。 */
export const UndoTabRecordSchema = z.object({
  url: z.string(),
  // index / groupId 必须是整数（浏览器 API 的位置与组 id），小数会让恢复静默失败。
  index: z.number().int(),
  pinned: z.boolean(),
  muted: z.boolean(),
  groupId: z.number().int(),
  /** 原组名（组已删除时按名重建）。 */
  groupName: z.string().optional()
});
export type UndoTabRecord = z.infer<typeof UndoTabRecordSchema>;

export const UndoBatchSchema = z.object({
  id: z.string(),
  /** 批次类别（'restore' 等）。用 `z.string()` 而非 enum：未知类别不应判坏整条记录；只长度封顶防注入。 */
  kind: z.string().min(1).max(32),
  createdAt: z.number(),
  /** 关闭发生时的窗口 id（缺省即未记录）。撤销必须回到原窗口，否则切到别的窗口撤销会恢复到错误窗口。 */
  windowId: z.number().int().optional(),
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
  /** 静音状态（恢复时还原；缺省为 false）。 */
  muted: z.boolean().default(false),
  /** 快照时所在原生组标题（未分组时缺省；恢复时按名并入或重建）。 */
  groupTitle: z.string().optional(),
  /** 快照时原生组颜色（Chrome 色名，重建时还原）。非法色名降级为缺省而非判坏：畸形装饰数据不该让整份备份失败。 */
  // 只在末尾加 .optional()：内层 optional 是死代码（外层遇 undefined 直接短路），且 transform 后 schema 不再 optional。
  groupColor: z.string().transform(toGroupColor).optional()
});
export type SnapshotTab = z.infer<typeof SnapshotTabSchema>;

/** 快照（命名快照 + 关窗自动保存），本地优先、零账号。 */
export const SnapshotSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** manual 用户手动命名 / auto 关窗自动保存 / archive 归档（关闭但保存）/ space 工作区（复用快照）。 */
    origin: z.enum(['manual', 'auto', 'archive', 'space']),
    createdAt: z.number(),
    windowId: z.number().optional(),
    tabCount: z.number().int().nonnegative(),
    tabs: z.array(SnapshotTabSchema).max(SNAPSHOT_TABS_LIMIT)
  })
  // tabCount 与 tabs.length 冗余，入库锁定一致性：导入可构造两者不等的数据，让 UI 计数与恢复条数漂移。
  .refine((snapshot) => snapshot.tabCount === snapshot.tabs.length, {
    message: 'tabCount must equal tabs.length'
  });
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** 导出格式版本号；导入仅接受当前版本。 */
export const EXPORT_FILE_VERSION = 1;

/** 导出/导入要求稳定且有界的 pin id；本地读盘 schema 保持宽松。 */
const ExportPersistentPinSchema = PersistentPinSchema.safeExtend({
  id: z.string().min(1).max(HOST_MAX_LENGTH)
});

/**
 * 导出格式 = 固定空间 + 图标 + 折叠态 + 设置 + 全部快照族。
 * version 是必填字面量、不做容错缺省：兜底会让无版本号的任意 JSON 按当前版本解析通过。
 * 导入端另有 ExportFileImportSchema（图标加固副本，favIconUrl 只接受 data:image/、chrome://、chrome-extension://）。
 */
export const ExportFileSchema = z
  .object({
    format: z.literal('tabs.export'),
    version: z.literal(EXPORT_FILE_VERSION),
    exportedAt: z.string(),
    fixedFolders: z.array(FixedFolderSchema).max(FOLDERS_LIMIT),
    persistentPins: z
      .array(ExportPersistentPinSchema)
      .max(PINS_LIMIT)
      .superRefine((pins, context) => {
        const seen = new Set<string>();
        pins.forEach((pin, index) => {
          if (seen.has(pin.id)) {
            context.addIssue({
              code: 'custom',
              path: [index, 'id'],
              message: 'persistent pin ids must be unique'
            });
            return;
          }
          seen.add(pin.id);
        });
      }),
    siteCollapse: SiteCollapseSchema,
    settings: SettingsSchema,
    /** 快照族：manual 命名快照 / auto 关窗自动 / archive 归档 / space 工作区。 */
    snapshots: z.array(SnapshotSchema).max(SNAPSHOTS_LIMIT).default([])
  })
  .superRefine((file, context) => {
    // id 是恢复后更新实体的身份键：重复 id 必须拒绝整份备份，不能靠后写覆盖前一条。
    const folderIds = new Set<string>();
    const itemIds = new Set<string>();
    file.fixedFolders.forEach((folder, folderIndex) => {
      if (folderIds.has(folder.id)) {
        context.addIssue({
          code: 'custom',
          path: ['fixedFolders', folderIndex, 'id'],
          message: 'fixed folder ids must be unique'
        });
      } else {
        folderIds.add(folder.id);
      }
      // item id 的唯一域是整份备份，而不只是所属文件夹。
      folder.items.forEach((item, itemIndex) => {
        if (itemIds.has(item.id)) {
          context.addIssue({
            code: 'custom',
            path: ['fixedFolders', folderIndex, 'items', itemIndex, 'id'],
            message: 'fixed folder item ids must be globally unique'
          });
        } else {
          itemIds.add(item.id);
        }
      });
    });

    const snapshotIds = new Set<string>();
    file.snapshots.forEach((snapshot, index) => {
      if (snapshotIds.has(snapshot.id)) {
        context.addIssue({
          code: 'custom',
          path: ['snapshots', index, 'id'],
          message: 'snapshot ids must be unique'
        });
      } else {
        snapshotIds.add(snapshot.id);
      }
    });
  });

export type ExportFile = z.infer<typeof ExportFileSchema>;

/**
 * 导入侧 favicon scheme 白名单。渲染图标会发起图片请求，备份里任意 http(s) 等于「备份可指定扩展向任意站点发请求」，
 * 故只在导入侧收紧（基础 schema 也用于运行时读盘，收紧会误伤本机写入的 http(s) 图标）。
 * 校验在 zod 层，导入数据无法绕过；越界图标降级为回退首字母而非判坏。
 */
const IMPORT_FAVICON_SCHEME = /^(?:data:image\/|chrome:\/\/|chrome-extension:\/\/)/i;

/** 导入侧图标字段：长度封顶 + scheme 白名单归一化。超长/非白名单一律归一为 `undefined` 而非判坏——图标是装饰数据，不能让一个畸形图标升级为整份备份被拒。 */
export const ImportFaviconUrlSchema = z
  .string()
  .transform((value) =>
    value.length <= FAVICON_URL_MAX_LENGTH && IMPORT_FAVICON_SCHEME.test(value) ? value : undefined
  )
  .optional();

/**
 * 导入侧网址字段：只放行 `http:` / `https:`，其余（`javascript:` / `data:` / `file:` / `chrome://`）降级为占位。
 * 备份的 `url` 会被拿去 `tabs.create` / 渲染成可点击条目。归一为占位而非丢弃条目：快照有
 * `tabCount === tabs.length` 校验，丢条目会让其失衡并拒掉整份备份。只作用于导入专用 schema。
 */
/** 网址被判为不安全时的占位值：不可执行脚本、不指向内部页。 */
const UNSAFE_URL_PLACEHOLDER = 'about:blank';
export const ImportUrlSchema = z
  .string()
  .transform((value) => (isHttpUrl(value) ? value : UNSAFE_URL_PLACEHOLDER));

/** 导入专用条目：收紧 favIconUrl 与 url，其余同运行时。url 必须保持可选：挂起条目本就没有 url，覆盖成必填会把它们判成坏数据。 */
const ImportFixedFolderItemSchema = FixedFolderItemSchema.safeExtend({
  favIconUrl: ImportFaviconUrlSchema,
  url: ImportUrlSchema.optional()
});
/** 外部输入专用的固定文件夹 schema（备份导入 + 同步镜像共用）。命名 `Inbound*`：适用面是一切外部可控输入，同步镜像同样不在信任边界内；共用避免口径分叉。基础 schema 保持宽松（读盘用）。 */
export const InboundFixedFolderSchema = FixedFolderSchema.safeExtend({
  items: z.array(ImportFixedFolderItemSchema).max(FOLDER_ITEMS_LIMIT)
});
/**
 * 外部输入专用磁贴 schema：identity 由归一化后的 url 重算。外来 identity 若与 url 不一致
 * （url 已降为 about:blank 而 identity 仍指向原站），dedupePins 会按失真身份判重，产出点开是新标签页的磁贴。
 */
export const InboundPersistentPinSchema = PersistentPinSchema.safeExtend({
  id: z.string().min(1).max(HOST_MAX_LENGTH),
  favIconUrl: ImportFaviconUrlSchema,
  url: ImportUrlSchema
}).transform((pin) => {
  // url 降为占位时 pinIdentity 返回 null：保留有效输入 identity；空 identity 则用 pin id，避免多个占位磁贴互相去重。
  const identity = pinIdentity(pin.url);
  if (identity !== null) return { ...pin, identity };
  const retainedIdentity = pin.identity.trim();
  return retainedIdentity ? { ...pin, identity: retainedIdentity } : { ...pin, identity: pin.id };
});
export const InboundPersistentPinListSchema = z
  .array(InboundPersistentPinSchema)
  .max(PINS_LIMIT)
  .superRefine((pins, context) => {
    const seen = new Set<string>();
    pins.forEach((pin, index) => {
      if (seen.has(pin.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'persistent pin ids must be unique'
        });
        return;
      }
      seen.add(pin.id);
    });
  });
const ImportSnapshotTabSchema = SnapshotTabSchema.safeExtend({
  favIconUrl: ImportFaviconUrlSchema,
  url: ImportUrlSchema
});
/** SnapshotSchema 带 refine（tabCount === tabs.length），safeExtend 会保留该校验。 */
const ImportSnapshotSchema = SnapshotSchema.safeExtend({
  tabs: z.array(ImportSnapshotTabSchema).max(SNAPSHOT_TABS_LIMIT)
});

/** 导入专用导出 schema：与导出同形，分区内条目改用受图标约束版本。只被 parseExportFile 使用；导出侧仍走 ExportFileSchema（原样写图标，保证导出→导入不丢信息）。 */
const ExportFileImportSchema = ExportFileSchema.safeExtend({
  fixedFolders: z.array(InboundFixedFolderSchema).max(FOLDERS_LIMIT),
  persistentPins: InboundPersistentPinListSchema,
  snapshots: z.array(ImportSnapshotSchema).max(SNAPSHOTS_LIMIT).default([])
});

/**
 * 导出文件统一读取口径：单一格式，不匹配即拒（不静默降级），只认 EXPORT_FILE_VERSION。
 * 版本不匹配与文件校验失败返回不同原因，界面据此给出对应提示。
 * 解析走导入专用 schema：favIconUrl 经 scheme 白名单归一化（任意 http(s) 图标 → undefined）。
 */
export function parseExportFile(
  raw: unknown
):
  { success: true; data: ExportFile } | { success: false; reason: 'version-mismatch' | 'invalid' } {
  const parsed = ExportFileImportSchema.safeParse(raw);
  if (parsed.success) return { success: true, data: parsed.data };
  const header = z.object({ format: z.literal('tabs.export'), version: z.number() }).safeParse(raw);
  if (header.success && header.data.version !== EXPORT_FILE_VERSION) {
    return { success: false, reason: 'version-mismatch' };
  }
  return { success: false, reason: 'invalid' };
}
