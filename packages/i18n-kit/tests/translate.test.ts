import { describe, expect, it } from 'vitest';
import { createTranslate, toHashKey, type I18nLike } from 'i18n-kit';

/**
 * 查表逻辑的行为规格（UI 轨道与后台轨道共用这一份实现）。
 *
 * 用假实例而不是真 i18next：这里要锁的是「走哪条路径、传什么参数」，
 * 真实例的解析由 `runtime-resolution.test.ts` 覆盖。
 */
const fake = (
  resources: Record<string, string>
): I18nLike & { calls: Array<[string, unknown]> } => {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    t(key: string, options?: Record<string, unknown>) {
      calls.push([key, options]);
      return resources[key] ?? options?.defaultValue ?? key;
    }
  };
};

describe('createTranslate', () => {
  it('Given 含汉字的原文，When 翻译，Then 用哈希 key 查表并带上原文兜底', () => {
    const i18n = fake({ [toHashKey('编辑标签组')]: 'Edit group' });
    const t = createTranslate(i18n);

    expect(t('编辑标签组')).toBe('Edit group');
    const [key, options] = i18n.calls[0] ?? [];
    expect(key).toBe(toHashKey('编辑标签组'));
    expect(options).toMatchObject({ defaultValue: '编辑标签组' });
  });

  it('Given 不含汉字的语义 key，When 翻译，Then 原样查表（动态拼接场景仍可用）', () => {
    const i18n = fake({ 'groups.color.grey': 'Grey' });
    const t = createTranslate(i18n);

    expect(t('groups.color.grey')).toBe('Grey');
    const [key, options] = i18n.calls[0] ?? [];
    expect(key).toBe('groups.color.grey');
    // 语义 key 不该被塞 defaultValue：否则查不到时返回的是中文原文，等于掩盖漏译
    expect(options).toBeUndefined();
  });

  it('Given context，When 翻译，Then key 带上下文后缀', () => {
    const i18n = fake({ [`${toHashKey('打开')}_verb`]: 'Open' });
    const t = createTranslate(i18n);

    expect(t('打开', { context: 'verb' })).toBe('Open');
    const [key] = i18n.calls[0] ?? [];
    expect(key).toBe(`${toHashKey('打开')}_verb`);
  });

  it('Given 未登记的原文，When 翻译，Then 回退中文原文（露中文比空白容易被发现）', () => {
    const i18n = fake({});
    const t = createTranslate(i18n);

    expect(t('从未登记过的一句文案')).toBe('从未登记过的一句文案');
  });

  it('Given 插值选项，When 翻译，Then 原样透传给 i18next', () => {
    const i18n = fake({});
    const t = createTranslate(i18n);

    t('共 {{count}} 个标签', { count: 3 });
    const [, options] = i18n.calls[0] ?? [];
    expect(options).toMatchObject({ count: 3 });
  });
});
