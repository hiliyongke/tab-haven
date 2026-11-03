// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import i18n from '@/i18n';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { useDataStore } from '@/stores/dataStore';
import { DEFAULT_SETTINGS } from '@/core/schema/models';

afterEach(() => {
  cleanup();
  useDataStore.setState({ settings: DEFAULT_SETTINGS });
  void i18n.changeLanguage('en');
  document.documentElement.dataset.scope = '';
  document.title = 'Tabs 设置';
  vi.restoreAllMocks();
});

describe('设置语言空值回退', () => {
  it('settings.language 为空时回到浏览器语言，并同步 html lang', async () => {
    await i18n.changeLanguage('zh-CN');
    useDataStore.setState({ settings: { ...DEFAULT_SETTINGS, language: undefined } });
    render(<SettingsSync />);
    await vi.waitFor(() => expect(i18n.language).toBe('en'));
    expect(document.documentElement.lang).toBe('en');
  });

  it('语言覆盖值存在时切到覆盖语言，空值后恢复浏览器语言', async () => {
    useDataStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'zh-CN' } });
    const { rerender } = render(<SettingsSync />);
    await vi.waitFor(() => expect(i18n.language).toBe('zh-CN'));
    useDataStore.setState({ settings: { ...DEFAULT_SETTINGS, language: undefined } });
    rerender(<SettingsSync />);
    await vi.waitFor(() => expect(i18n.language).toBe('en'));
  });

  it('设置页英文模式最终标题不再保留中文', async () => {
    document.documentElement.dataset.scope = 'options';
    await i18n.changeLanguage('en');
    expect(document.title).toBe('Tabs Settings');
  });
});
