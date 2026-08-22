import { DataRepository } from '@/platform/storage/DataRepository';
import {
  DEFAULT_SETTINGS,
  FixedFolderSchema,
  PersistentPinSchema,
  SettingsSchema,
  SiteCollapseSchema
} from '@/core/schema/models';
import type { FixedFolder, PersistentPin, Settings, SiteCollapseState } from '@/core/schema/models';

/**
 * 共享持久化仓库单例（storage key 的唯一权威出处）。
 *
 * dataStore 与 background 迁移流程共用同一组实例，保证：
 *  - key 字符串不重复硬编码；
 *  - 所有写入都经过 zod 校验（迁移也不例外）。
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
