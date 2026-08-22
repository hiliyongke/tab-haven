// 主题初始化必须最先执行（React CSR 场景：body 初始为空，
// 在首次渲染前设置 data-theme 即可完全避免主题闪烁）
import '../../theme-init';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../../i18n';
import '../../styles/main.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
