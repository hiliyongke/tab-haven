import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { applyTheme, watchSystemTheme } from '@/platform/theme/ThemeApplier';
import { useDataStore } from '@/stores/dataStore';

/**
 * 设置同步组件：主题应用（三态 + system 跟随）与语言切换。
 * 挂载于各形态入口（sidepanel / popup / full）。
 */
export function SettingsSync() {
  const preference = useDataStore((state) => state.settings.themePreference);
  const language = useDataStore((state) => state.settings.language);
  const { i18n } = useTranslation();

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [preference]);

  useEffect(() => {
    if (language) void i18n.changeLanguage(language);
  }, [language, i18n]);

  return null;
}
