import { describe, expect, it } from 'vitest';
import {
  buildExport,
  buildUrlList,
  mergeFolders,
  mergePins,
  parseImport,
  serializeExport,
  type ExportSource
} from '@/core/data/ExportService';
import { TabsteadMigrator } from '@/core/migrate/TabsteadMigrator';

/**
 * 行为规格（FR-D9.1/D9.2）：
 *  - 导出→导入 往返无损（逐字段一致）；
 *  - URL 列表人类可读；
 *  - 合并模式按 URL/身份去重；
 *  - 前身数据迁移：映射正确、坏分区跳过、身份去重。
 */
describe('ExportService', () => {
  const source: ExportSource = {
    folders: [
      {
        id: 'f1',
        name: '研究',
        collapsed: false,
        items: [
          { id: 'i1', url: 'https://a.com/', title: 'A', createdAt: 1 },
          { id: 'i2', url: 'https://b.com/', title: 'B', createdAt: 2 }
        ]
      }
    ],
    pins: [
      { id: 'p1', identity: 'example.com', url: 'https://example.com/', title: 'Example' }
    ],
    collapsedSites: ['a.com'],
    settings: { themePreference: 'dark', aggregationThreshold: 2 }
  };

  it('导出→解析 往返无损', () => {
    const exportFile = buildExport(source);
    const parsed = parseImport(serializeExport(exportFile));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.fixedFolders).toEqual(source.folders);
      expect(parsed.data.persistentPins).toEqual(source.pins);
      expect(parsed.data.settings).toEqual(source.settings);
      expect(parsed.data.siteCollapse).toEqual(['a.com']);
    }
  });

  it('URL 列表每行一个 URL 且去重', () => {
    const list = buildUrlList({ ...source, pins: [
      { id: 'p1', identity: 'example.com', url: 'https://example.com/', title: 'X' },
      { id: 'p2', identity: 'a.com', url: 'https://a.com/', title: 'A' }
    ]});
    expect(list.split('\n')).toEqual(['https://example.com/', 'https://a.com/', 'https://b.com/']);
  });

  it('非法 JSON 与格式错误被拒绝', () => {
    expect(parseImport('not json').ok).toBe(false);
    expect(parseImport('{"format":"other"}').ok).toBe(false);
  });

  it('合并模式：同 URL 条目去重', () => {
    const merged = mergeFolders(source.folders, [
      { id: 'f2', name: '新', collapsed: false, items: [
        { id: 'i9', url: 'https://a.com/', title: 'A 重复', createdAt: 9 },
        { id: 'i10', url: 'https://c.com/', title: 'C', createdAt: 10 }
      ]}
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1]?.items.map((item) => item.url)).toEqual(['https://c.com/']);
  });

  it('合并模式：pin 按身份去重', () => {
    const merged = mergePins(source.pins, [
      { id: 'p9', identity: 'example.com', url: 'https://example.com/x', title: '重复' },
      { id: 'p10', identity: 'other.com', url: 'https://other.com/', title: '新' }
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1]?.identity).toBe('other.com');
  });
});

describe('TabsteadMigrator', () => {
  it('迁移文件夹与固定图标，身份去重', () => {
    const migrator = new TabsteadMigrator();
    const { data, report } = migrator.migrate(
      [{ name: '工作', items: [{ url: 'https://a.com/', title: 'A' }] }],
      [
        { url: 'https://example.com/', title: 'Ex' },
        { url: 'https://example.com/path', title: 'Ex2' }
      ],
      'dark'
    );
    expect(data.folders).toHaveLength(1);
    expect(data.folders[0]?.items[0]?.url).toBe('https://a.com/');
    expect(data.pins).toHaveLength(1); // 同身份去重
    expect(data.themePreference).toBe('dark');
    expect(report.migratedFolders).toBe(1);
    expect(report.migratedPins).toBe(1);
    expect(report.migratedTheme).toBe(true);
  });

  it('坏分区跳过并报告', () => {
    const migrator = new TabsteadMigrator();
    const { data, report } = migrator.migrate('bad-data', [{ url: 'https://a.com/', title: 'A' }], 'dark');
    expect(data.folders).toHaveLength(0);
    expect(report.skipped).toContain('fixedFoldersV1');
    expect(report.migratedPins).toBe(1);
  });

  it('主题仅接受 light/dark 值', () => {
    const migrator = new TabsteadMigrator();
    const { data, report } = migrator.migrate([], [], 'weird-value');
    expect(data.themePreference).toBe('system');
    expect(report.migratedTheme).toBe(false);
  });
});
