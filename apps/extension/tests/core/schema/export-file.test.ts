import { describe, expect, it } from 'vitest';
import { EXPORT_FILE_VERSION, ExportFileSchema, parseExportFile } from '@/core/schema/models';

/**
 * 导出文件契约：`format`、`version` 与五个数据分区均符合当前 schema。
 * `parseExportFile` 是备份导入的唯一入口，只接受当前格式与版本。
 */

/** 版本号一律引用常量：硬编码会在格式演进时把「契约测试」变成绊脚石。 */
const VALID = {
  format: 'tabs.export',
  version: EXPORT_FILE_VERSION,
  exportedAt: '2026-09-04T00:00:00.000Z',
  fixedFolders: [],
  persistentPins: [],
  siteCollapse: [],
  settings: {},
  snapshots: []
};

describe('parseExportFile', () => {
  it('接受携带当前版本号的备份', () => {
    const result = parseExportFile(VALID);
    expect(result.success).toBe(true);
    expect(result.success && result.data.version).toBe(EXPORT_FILE_VERSION);
  });

  it('缺少 version 的备份被拒绝', () => {
    // 缺少版本号的输入不符合当前导出文件契约。
    const withoutVersion: Record<string, unknown> = { ...VALID };
    delete withoutVersion['version'];
    const result = parseExportFile(withoutVersion);
    expect(result.success).toBe(false);
    expect(result.success === false && result.reason).toBe('invalid');
  });

  it('其他版本的备份被拒绝', () => {
    // 只接受当前版本，不对版本不同的数据使用当前 schema 解析。
    const other = parseExportFile({ ...VALID, version: EXPORT_FILE_VERSION + 1 });
    expect(other.success).toBe(false);
    // 版本不匹配要能被识别出来：UI 据此给出「请用导出时的版本导入」提示
    expect(other.success === false && other.reason).toBe('version-mismatch');
    expect(parseExportFile({ ...VALID, version: 99 }).success).toBe(false);
    // 结构本身有问题则是 invalid（不是版本问题）
    const broken = parseExportFile({ ...VALID, fixedFolders: 'not-array' });
    expect(broken.success === false && broken.reason).toBe('invalid');
  });

  it('format 不符即拒绝（不静默降级）', () => {
    expect(parseExportFile({ ...VALID, format: 'other' }).success).toBe(false);
    expect(parseExportFile({ format: 'tabs.export' }).success).toBe(false);
  });

  it('非对象输入被拒绝', () => {
    for (const raw of [null, undefined, 42, 'x', []]) {
      expect(parseExportFile(raw).success).toBe(false);
    }
  });
});

describe('ExportFileSchema 版本号常量', () => {
  it('schema 版本号与导出常量一致', () => {
    expect(ExportFileSchema.parse(VALID).version).toBe(EXPORT_FILE_VERSION);
  });
});

describe('导入侧网址 scheme 白名单', () => {
  const withPin = (url: string) => ({
    ...VALID,
    persistentPins: [{ id: 'p1', identity: 'example.com', url, title: 'x' }],
    fixedFolders: [
      {
        id: 'f1',
        name: 'F',
        collapsed: false,
        items: [{ id: 'i1', url, title: 'x', createdAt: 1 }]
      }
    ]
  });

  it('保留 http(s) 网址', () => {
    const result = parseExportFile(withPin('https://example.com/a'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.persistentPins[0]?.url).toBe('https://example.com/a');
    expect(result.data.fixedFolders[0]?.items[0]?.url).toBe('https://example.com/a');
  });

  it('非 http(s) 的可执行与内部页 scheme 降级为安全占位', () => {
    // 导入数据中的非 http(s) 网址统一使用安全占位。
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'chrome://extensions'
    ]) {
      const result = parseExportFile(withPin(url));
      expect(result.success).toBe(true);
      if (!result.success) continue;
      expect(result.data.persistentPins[0]?.url).toBe('about:blank');
      expect(result.data.fixedFolders[0]?.items[0]?.url).toBe('about:blank');
    }
  });

  it('单条不可用网址降级后仍保留备份其余数据', () => {
    const result = parseExportFile({
      ...withPin('javascript:alert(1)'),
      settings: { themePreference: 'dark' }
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.settings.themePreference).toBe('dark');
  });
});
