import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsPage } from './SettingsPage';
import '../../i18n';
import '../../styles/main.css';

/** 全页形态（FR-D10.1）：设置/导入导出/迁移引导的载体。 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsPage />
  </React.StrictMode>
);
