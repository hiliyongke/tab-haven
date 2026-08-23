import { z } from 'zod';
import { DataRepository } from '@/platform/storage/DataRepository';
import {
  AutoDiscardBatchSchema,
  DEFAULT_SETTINGS,
  FixedFolderSchema,
  PersistentPinSchema,
  SettingsSchema,
  SiteCollapseSchema,
  UndoBatchSchema
} from '@/core/schema/models';
import type {
  AutoDiscardBatch,
  FixedFolder,
  PersistentPin,
  Settings,
  SiteCollapseState,
  UndoBatch
} from '@/core/schema/models';

/**
 * 共享持久化仓库单例（storage key 的唯一权威出处）。
 *
 * dataStore 与 background 写入流程共用同一组实例，保证：
 *  - key 字符串不重复硬编码；
 *  - 所有写入都经过 zod 校验。
 */

export const foldersRepository = new DataRepository<FixedFolder[]>(
  'tabhaven.fixed-folders.v1',
  FixedFolderSchema.array(),
  []
);

export const pinsRepository = new DataRepository<PersistentPin[]>(
  'tabhaven.persistent-pins.v1',
  PersistentPinSchema.array(),
  []
);

export const collapseRepository = new DataRepository<SiteCollapseState>(
  'tabhaven.site-collapse.v1',
  SiteCollapseSchema,
  []
);

export const settingsRepository = new DataRepository<Settings>(
  'tabhaven.settings.v1',
  SettingsSchema,
  DEFAULT_SETTINGS
);

export const undoRepository = new DataRepository<UndoBatch[]>(
  'tabhaven.undo-stack.v1',
  UndoBatchSchema.array(),
  []
);

export const autoGroupsRepository = new DataRepository<number[]>(
  'tabhaven.auto-groups.v1',
  z.array(z.number()),
  []
);

export const autoDiscardRepository = new DataRepository<AutoDiscardBatch | null>(
  'tabhaven.auto-discard-batch.v1',
  AutoDiscardBatchSchema.nullable(),
  null
);

/** 首次启动标志：false 表示新设备（可从浏览器同步通道镜像恢复）。 */
export const seededRepository = new DataRepository<boolean>(
  'tabhaven.sync-seeded.v1',
  z.boolean(),
  false
);
