// 主题初始化最先执行（同 sidepanel 的防闪烁策略）
import '../../theme-init';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '@/ui/common/ErrorBoundary';
import { installGlobalErrorHandlers } from '@/platform/diagnostics';
import '../../i18n';
import '../../styles/main.css';

// 全局异常兜底（同 sidepanel：ErrorBoundary 不覆盖事件处理器与异步回调）
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="popup">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
