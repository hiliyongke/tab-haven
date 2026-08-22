import { z } from 'zod';
import type { FixedFolder, PersistentPin, Settings } from '@/core/schema/models';
import { pinIdentity } from '@/core/fixed/PinIdentity';

/**
 * Tabstead 数据迁移（FR-D9.2，数据级迁移——读取前身产品本地数据，
 * 映射为本产品 schema。一次性单向、幂等、分区报告，绝不写回原数据）。
 */

export interface MigrationReport {
  migratedFolders: number;
  migratedPins: number;
  migratedTheme: boolean;
  skipped: string[];
}

export interface TabsteadLegacyData {
  folders: FixedFolder[];
  pins: PersistentPin[];
  themePreference: Settings['themePreference'];
}

/** 宽松解析（旧数据格式不做严格校验，逐字段防御性提取）。 */
const LegacyItemSchema = z
  .object({
    id: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    favIconUrl: z.string().optional(),
    pendingTabId: z.number().int().optional()
  })
  .passthrough();

const LegacyFolderSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    collapsed: z.boolean().optional(),
    items: z.array(LegacyItemSchema).optional()
  })
  .passthrough();

const LegacyPinSchema = z
  .object({
    id: z.string().optional(),
    identity: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    favIconUrl: z.string().optional()
  })
  .passthrough();

export class TabsteadMigrator {
  /** 迁移前身数据；返回报告与产物。 */
  migrate(
    rawFolders: unknown,
    rawPins: unknown,
    rawTheme: unknown
  ): { data: TabsteadLegacyData; report: MigrationReport } {
    const report: MigrationReport = {
      migratedFolders: 0,
      migratedPins: 0,
      migratedTheme: false,
      skipped: []
    };

    const folders: FixedFolder[] = [];
    const folderList = z.array(LegacyFolderSchema).safeParse(rawFolders);
    if (folderList.success) {
      for (const legacy of folderList.data) {
        const items = (legacy.items ?? [])
          .filter((item) => typeof item.url === 'string' && item.url)
          .map((item) => ({
            id: item.id || crypto.randomUUID(),
            url: item.url as string,
            title: item.title || ((item.url as string) ?? ''),
            favIconUrl: item.favIconUrl,
            pendingTabId: item.pendingTabId,
            createdAt: Date.now()
          }));
        folders.push({
          id: legacy.id || crypto.randomUUID(),
          name: legacy.name || '迁移文件夹',
          collapsed: legacy.collapsed ?? false,
          items
        });
      }
      report.migratedFolders = folders.length;
    } else {
      report.skipped.push('fixedFoldersV1');
    }

    const pins: PersistentPin[] = [];
    const pinList = z.array(LegacyPinSchema).safeParse(rawPins);
    if (pinList.success) {
      const seen = new Set<string>();
      for (const legacy of pinList.data) {
        if (!legacy.url) continue;
        const identity = legacy.identity || pinIdentity(legacy.url);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        pins.push({
          id: legacy.id || crypto.randomUUID(),
          identity,
          url: legacy.url,
          title: legacy.title || legacy.url,
          favIconUrl: legacy.favIconUrl
        });
      }
      report.migratedPins = pins.length;
    } else {
      report.skipped.push('persistentPinsV1');
    }

    let themePreference: Settings['themePreference'] = 'system';
    if (rawTheme === 'light' || rawTheme === 'dark') {
      themePreference = rawTheme;
      report.migratedTheme = true;
    }

    return { data: { folders, pins, themePreference }, report };
  }
}

/** 幂等迁移标记 key。 */
export const MIGRATION_MARKER_KEY = 'tabhaven.migrated.v1';
