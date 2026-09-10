import { describe, expect, it } from 'vitest';
import { AutoDiscardBatchSchema, DEFAULT_SETTINGS, SettingsSchema } from '@/core/schema/models';

/**
 * schema 层行为规格：
 *  - SettingsSchema.parse({}) 必须与 DEFAULT_SETTINGS 一致（默认值单一事实源）；
 *  - 非法数据必须被拒绝（safeParse 失败路径有消费方：仓库层隔离坏数据）；
 *  - AutoDiscardBatch 的 count 冗余字段必须与 tabIds.length 一致。
 */
describe('SettingsSchema', () => {
  it('空对象解析成功（任一字段漏写 .default() 即在此崩溃性失败）', () => {
    expect(SettingsSchema.safeParse({}).success).toBe(true);
  });

  it('空对象解析结果与 DEFAULT_SETTINGS 完全一致', () => {
    expect(SettingsSchema.parse({})).toEqual(DEFAULT_SETTINGS);
  });

  it('默认设置键集与空对象解析结果完全一致（未遗漏/多余的字段）', () => {
    // 与 parse({}) 的键集比对：新增字段时两侧自动同步、测试自适应，不写死计数。
    // 注意：可选且无输入的字段（如 language）解析后值恒为 undefined，zod 会将其从
    // Object.keys 中剔除，故基准取「解析结果自身的键」而非 schema.shape（后者含 language）。
    const parsed = SettingsSchema.parse({});
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(Object.keys(parsed).sort());
  });

  it('默认设置包含全部关键字段，且字段数符合预期规模', () => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    // 关键字段必须存在（覆盖外观 / 同步开关 / 缓存 / 自动休眠等分组）。
    for (const key of [
      'themePreference',
      'syncMirrorEnabled',
      'noCachePatterns',
      'discardWhitelist',
      'autoSaveSnapshots',
      'onboarded',
      'conceptsSeen'
    ]) {
      expect(keys).toContain(key);
    }
    // 规模守护：新增设置项时此下限自然满足，防止 schema 被整体清空导致 DEFAULT_SETTINGS 塌缩。
    expect(keys.length).toBeGreaterThanOrEqual(40);
  });

  it('部分字段缺失时补默认值，已存字段保留', () => {
    const parsed = SettingsSchema.parse({ themePreference: 'dark', showUrl: true });
    expect(parsed.themePreference).toBe('dark');
    expect(parsed.showUrl).toBe(true);
    expect(parsed.aggregationThreshold).toBe(2);
    expect(parsed.tabOrderSync).toBe(true);
  });

  it('非法值被拒绝（safeParse 失败路径）', () => {
    expect(SettingsSchema.safeParse({ themePreference: 'neon' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ aggregationThreshold: 0 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ aggregationThreshold: 6 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ toastDurationSec: 0 }).success).toBe(false);
  });

  it('language 宽松校验：缺省 undefined，合法 BCP-47 通过', () => {
    expect(SettingsSchema.parse({}).language).toBeUndefined();
    expect(SettingsSchema.parse({ language: 'zh-CN' }).language).toBe('zh-CN');
    expect(SettingsSchema.safeParse({ language: 'x' }).success).toBe(false);
  });

  it('已移除的旧字段不会导致解析失败（未知键被剥离而非报错）', () => {
    // noCacheBannerEnabled 已随「页面内横幅」能力下线而移除（横幅改由侧边栏角标呈现）。
    // 旧安装的存储值与旧备份文件里仍可能带该键：这里必须**解析成功**并把该键剥离，
    // 否则用户升级后整块设置会被 DataRepository 判为坏数据隔离，回退成默认值。
    const legacy = { ...DEFAULT_SETTINGS, noCacheBannerEnabled: false };
    const parsed = SettingsSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('noCacheBannerEnabled' in parsed.data).toBe(false);
      expect(parsed.data.themePreference).toBe(DEFAULT_SETTINGS.themePreference);
      expect(parsed.data.noCachePatterns).toEqual(DEFAULT_SETTINGS.noCachePatterns);
    }
  });
});

describe('AutoDiscardBatchSchema', () => {
  it('count 与 tabIds.length 一致时通过', () => {
    expect(AutoDiscardBatchSchema.safeParse({ tabIds: [1, 2], at: 123, count: 2 }).success).toBe(
      true
    );
  });

  it('count 与 tabIds.length 不一致时拒绝（防脏数据）', () => {
    expect(AutoDiscardBatchSchema.safeParse({ tabIds: [1, 2], at: 123, count: 5 }).success).toBe(
      false
    );
  });
});
