import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../i18n';
import '../../styles/main.css';

/** 全页形态占位：设置、导入导出、迁移引导的载体（FR-D10.1）。 */
function FullPage() {
  return <main className="full-page">TabHaven</main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FullPage />
  </React.StrictMode>
);
