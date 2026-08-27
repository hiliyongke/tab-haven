import '../../theme-init';
import { useEffect } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsPage } from '@/entrypoints/options/SettingsPage';
import { useDataStore } from '@/stores/dataStore';
import { ErrorBoundary } from '@/ui/common/ErrorBoundary';
import { SettingsSync } from '@/ui/common/SettingsSync';
import '../../i18n';
import '../../styles/main.css';

function OptionsRoot() {
  const initialize = useDataStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <>
      <SettingsSync />
      <SettingsPage />
    </>
  );
}

/** 设置页：注册为扩展 options_ui，侧边栏齿轮按钮通过 openOptionsPage 打开。 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="options">
      <OptionsRoot />
    </ErrorBoundary>
  </React.StrictMode>
);
