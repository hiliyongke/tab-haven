import '../../theme-init';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsPage } from '@/entrypoints/options/SettingsPage';
import { ErrorBoundary } from '@/ui/common/ErrorBoundary';
import { EntryRoot } from '@/ui/common/EntryRoot';
import { installGlobalErrorHandlers } from '@/platform/diagnostics';
import '../../i18n';
import '../../styles/main.css';

// 全局异常兜底（同 sidepanel：ErrorBoundary 不覆盖事件处理器与异步回调）
installGlobalErrorHandlers();

/** 设置页：注册为扩展 options_ui，侧边栏齿轮按钮通过 openOptionsPage 打开。 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="options">
      <EntryRoot scope="options">
        <SettingsPage />
      </EntryRoot>
    </ErrorBoundary>
  </React.StrictMode>
);
