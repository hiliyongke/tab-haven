import { describe, expect, it } from 'vitest';
import { EXPORT_FILE_VERSION, ExportFileSchema, parseExportFile } from '@/core/schema/models';

/**
 * 导出文件契约：`format` + `version` + 五个数据分区。
 *
 * 此前 `parseExportFile` 零测试，而它是备份导入的唯一入口 ——
 * 备份是用户「换机不丢数据」的唯一指望，契约松一点就是数据事故。
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

  it('缺 version 即拒绝：不为无版本号的备份开口子', () => {
    // 场景：任意 JSON（甚至别的扩展导出的文件）都没有 version 字段。
    // 若缺省兜底为当前版本，等于让无版本号的任意结构按当前格式解析通过，
    // 「单一格式、版本不符即拒绝」的口径就形同虚设。
    const withoutVersion: Record<string, unknown> = { ...VALID };
    delete withoutVersion['version'];
    const result = parseExportFile(withoutVersion);
    expect(result.success).toBe(false);
    expect(result.success === false && result.reason).toBe('invalid');
  });

  it('其他版本被拒绝：旧版扩展不得误读新版数据结构', () => {
    // 场景：用户用新版扩展导出备份，又装回旧版扩展导入。
    // 若此处放行，旧代码会把不认识的新字段当数据处理，或把缺失字段填成默认值。
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
  it('schema 的字面量与导出常量一致（改常量必须同步改 schema）', () => {
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

  it('可执行 / 内部页 scheme 一律降级为安全占位', () => {
    // 场景：备份文件可被手工构造。javascript: / data: / file: / chrome:// 若原样落盘，
    // 之后点击条目就会在标签上下文里执行或跳到内部页。
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

  it('一条畸形网址不会把整份备份判死（归一化而非判坏）', () => {
    const result = parseExportFile({
      ...withPin('javascript:alert(1)'),
      settings: { themePreference: 'dark' }
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.settings.themePreference).toBe('dark');
  });
});
