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

  it('缺 version 时按当前版本处理（容错早期备份）', () => {
    const withoutVersion: Record<string, unknown> = { ...VALID };
    delete withoutVersion['version'];
    const result = parseExportFile(withoutVersion);
    expect(result.success).toBe(true);
    expect(result.success && result.data.version).toBe(EXPORT_FILE_VERSION);
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
