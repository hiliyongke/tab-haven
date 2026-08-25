import { describe, expect, it } from 'vitest';
import {
  AutoDiscardBatchSchema,
  DEFAULT_SETTINGS,
  SettingsSchema
} from '@/core/schema/models';

/**
 * schema 层行为规格：
 *  - SettingsSchema.parse({}) 必须与 DEFAULT_SETTINGS 一致（默认值单一事实源）；
 *  - 非法数据必须被拒绝（safeParse 失败路径有消费方：仓库层隔离坏数据）；
 *  - AutoDiscardBatch 的 count 冗余字段必须与 tabIds.length 一致。
 */
describe('SettingsSchema', () => {
  it('空对象解析结果与 DEFAULT_SETTINGS 完全一致', () => {
    expect(SettingsSchema.parse({})).toEqual(DEFAULT_SETTINGS);
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
});

describe('AutoDiscardBatchSchema', () => {
  it('count 与 tabIds.length 一致时通过', () => {
    expect(
      AutoDiscardBatchSchema.safeParse({ tabIds: [1, 2], at: 123, count: 2 }).success
    ).toBe(true);
  });

  it('count 与 tabIds.length 不一致时拒绝（防脏数据）', () => {
    expect(
      AutoDiscardBatchSchema.safeParse({ tabIds: [1, 2], at: 123, count: 5 }).success
    ).toBe(false);
  });
});
