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

export const SettingsSchema = z.object({
  themePreference: z.enum(['system', 'light', 'dark']),
  language: z.string().optional(),
  aggregationThreshold: z.number().int().min(2).max(5)
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  themePreference: 'system',
  language: undefined,
  aggregationThreshold: 2
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
