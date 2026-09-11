import '../../theme-init';
import { useEffect } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AboutPage } from '@/entrypoints/about/AboutPage';
import { useDataStore } from '@/stores/dataStore';
import { ErrorBoundary } from '@/ui/common/ErrorBoundary';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { installGlobalErrorHandlers } from '@/platform/diagnostics';
import '../../i18n';
import '../../styles/main.css';

// 全局异常兜底（与 options / sidepanel 同口径）
installGlobalErrorHandlers();

function AboutRoot() {
  const initialize = useDataStore((state) => state.initialize);

  // 读取设置以应用主题/语言（关于页本身无数据操作，只需读）
  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <>
      <SettingsSync />
      <AboutPage />
    </>
  );
}

/**
 * 关于页：能力总览。
 *
 * 独立入口而非设置页内的区块 —— 它是「产品说明」而不是「配置项」，
 * 与设置页（决策面板）的心智模型不同；独立页面也能用更宽的版式呈现能力网格。
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="about">
      <AboutRoot />
    </ErrorBoundary>
  </React.StrictMode>
);
