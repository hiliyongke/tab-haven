import { useEffect } from 'react';
import { applyTheme, watchSystemTheme } from '@/platform/theme/ThemeApplier';
import { useDataStore } from '@/stores/dataStore';

/**
 * 主题绑定组件：订阅设置中的主题偏好并应用到 documentElement；
 * system 模式跟随系统配色变化。
 */
export function ThemeSync() {
  const preference = useDataStore((state) => state.settings.themePreference);

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [preference]);

  return null;
}
