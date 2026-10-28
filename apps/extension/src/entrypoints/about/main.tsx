import '@/theme-init';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AboutPage } from '@/entrypoints/about/AboutPage';
import { ErrorBoundary } from '@/ui/common/ErrorBoundary';
import { EntryRoot } from '@/ui/common/EntryRoot';
import { installGlobalErrorHandlers } from '@/platform/diagnostics';
import '@/i18n';
import '@/styles/main.css';

// 全局异常兜底（与 options / sidepanel 同口径）
installGlobalErrorHandlers();

/**
 * 关于页：能力总览。
 *
 * 独立入口而非设置页内的区块 —— 它是「产品说明」而不是「配置项」，
 * 与设置页（决策面板）的心智模型不同；独立页面也能用更宽的版式呈现能力网格。
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="about">
      <EntryRoot scope="about" layout="page">
        <AboutPage />
      </EntryRoot>
    </ErrorBoundary>
  </React.StrictMode>
);
