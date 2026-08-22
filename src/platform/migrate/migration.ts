import { browser } from 'wxt/browser';
import { TabsteadMigrator, MIGRATION_MARKER_KEY, type MigrationReport } from '@/core/migrate/TabsteadMigrator';
import { useDataStore } from '@/stores/dataStore';

/**
 * 迁移协调（FR-D9.2）：读取前身产品数据 → 映射 → 写入本产品存储 → 置幂等标记。
 * 只读旧 key，绝不写回；任一分区失败仅跳过该分区。
 */

/** 前身产品使用的存储 key（只读）。 */
const LEGACY_KEYS = {
  folders: 'fixedFoldersV1',
  pins: 'persistentPinsV1',
  theme: 'themePreferenceModeV2'
} as const;

export async function hasLegacyData(): Promise<boolean> {
  const marker = await browser.storage.local.get(MIGRATION_MARKER_KEY);
  if (marker[MIGRATION_MARKER_KEY]) return false;
  const stored = await browser.storage.local.get([LEGACY_KEYS.folders, LEGACY_KEYS.pins]);
  return stored[LEGACY_KEYS.folders] !== undefined || stored[LEGACY_KEYS.pins] !== undefined;
}

export async function migrateFromTabstead(): Promise<MigrationReport> {
  const stored = await browser.storage.local.get([
    LEGACY_KEYS.folders,
    LEGACY_KEYS.pins,
    LEGACY_KEYS.theme
  ]);

  const migrator = new TabsteadMigrator();
  const { data, report } = migrator.migrate(
    stored[LEGACY_KEYS.folders],
    stored[LEGACY_KEYS.pins],
    stored[LEGACY_KEYS.theme]
  );

  // 写入本产品数据（无数据分区跳过）
  const dataStore = useDataStore.getState();
  if (data.folders.length > 0) {
    await browser.storage.local.set({
      'tabhaven.fixed-folders.v1': data.folders
    });
  }
  if (data.pins.length > 0) {
    await browser.storage.local.set({
      'tabhaven.persistent-pins.v1': data.pins
    });
  }
  if (report.migratedTheme) {
    await browser.storage.local.set({
      'tabhaven.settings.v1': { themePreference: data.themePreference, aggregationThreshold: 2 }
    });
  }

  // 幂等标记 + 刷新内存态
  await browser.storage.local.set({ [MIGRATION_MARKER_KEY]: { tabstead: true } });
  await dataStore.initialize();

  return report;
}
