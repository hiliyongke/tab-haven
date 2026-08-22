// 主题初始化必须最先执行（React CSR 场景：body 初始为空，
// 在首次渲染前设置 data-theme 即可完全避免主题闪烁）
import '../../theme-init';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '@/ui/common/ErrorBoundary';
import { installGlobalErrorHandlers } from '@/platform/diagnostics';
import '../../i18n';
import '../../styles/main.css';

// 全局异常兜底必须在首次渲染前安装：挂载阶段漏网的 rejection 同样要能进诊断环形缓冲
// （ErrorBoundary 只覆盖渲染期异常，不覆盖事件处理器与异步回调）。
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="sidepanel">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
