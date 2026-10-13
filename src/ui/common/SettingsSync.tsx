import { useEffect } from 'react';
import { useTranslation } from '@/i18n';
import { applyTheme, watchSystemTheme } from '@/platform/theme/ThemeApplier';
import { useDataStore } from '@/stores/dataStore';

/**
 * 设置同步组件：主题应用（三态 + system 跟随）与语言切换。
 * 挂载于各形态入口（sidepanel / options / about）。
 */
export function SettingsSync() {
  const preference = useDataStore((state) => state.settings.themePreference);
  const colorTheme = useDataStore((state) => state.settings.colorTheme);
  const language = useDataStore((state) => state.settings.language);
  const { i18n } = useTranslation();

  useEffect(() => {
    applyTheme(preference, colorTheme);
    if (preference !== 'system') return;
    return watchSystemTheme(() => applyTheme('system', colorTheme));
  }, [preference, colorTheme]);

  useEffect(() => {
    if (language) void i18n.changeLanguage(language);
    // <html lang> 不在此处写：i18n 轨道（`src/i18n/index.ts` 的 syncDocumentLang）
    // 订阅 languageChanged 统一维护。两处都写会在「设置刚落地、语言事件还没触发」
    // 的窗口里互相覆盖，出现 <html lang> 与实际界面语言不一致。
  }, [language, i18n]);

  return null;
}
