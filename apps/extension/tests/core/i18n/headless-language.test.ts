// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';

/**
 * 后台文案轨道的语言决策规格：settings.language 清空后必须回到浏览器语言，
 * 不能停留在上一次的用户覆盖值。模块级 started 标记随 vi.resetModules 重置。
 */

type SettingsRepository = (typeof import('@/platform/storage/repositories'))['settingsRepository'];
let settingsRepository: SettingsRepository;

beforeEach(async () => {
  vi.resetModules();
  fakeBrowser.reset();
  ({ settingsRepository } = await import('@/platform/storage/repositories'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fakeBrowser.reset();
});

describe('headless i18n 语言回退', () => {
  it('设置覆盖值清空后 watcher 切回浏览器语言', async () => {
    const watch = vi.spyOn(settingsRepository, 'watch');
    const { initHeadlessI18n, t } = await import('@/i18n/headless');
    vi.spyOn(globalThis.navigator, 'language', 'get').mockReturnValue('en-US');
    await settingsRepository.write({ ...DEFAULT_SETTINGS, language: 'zh-CN' });
    await initHeadlessI18n();

    expect(t('设置')).toBe('设置');
    const listener = watch.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf('function');
    listener?.({ ...DEFAULT_SETTINGS, language: undefined });
    await vi.waitFor(() => expect(t('设置')).toBe('Settings'));
  });
});
