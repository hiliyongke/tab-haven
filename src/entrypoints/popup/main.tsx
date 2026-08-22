// 主题初始化最先执行（同 sidepanel 的防闪烁策略）
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
