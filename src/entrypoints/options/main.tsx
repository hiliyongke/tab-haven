import '../../theme-init';
import { useCallback, useEffect, useState } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsPage } from '@/entrypoints/options/SettingsPage';
import { useDataStore } from '@/stores/dataStore';
import { ErrorBoundary } from '@/ui/common/ErrorBoundary';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { LoadErrorState } from '@/entrypoints/sidepanel/ListStates';
import { installGlobalErrorHandlers, logFailure } from '@/platform/diagnostics';
import '../../i18n';
import '../../styles/main.css';

// 全局异常兜底（同 sidepanel：ErrorBoundary 不覆盖事件处理器与异步回调）
installGlobalErrorHandlers();

function OptionsRoot() {
  const initialize = useDataStore((state) => state.initialize);
  const [loadFailed, setLoadFailed] = useState(false);

  // 初始化失败必须可见：此前 `void initialize()` 无人接住，Promise 变成
  // unhandled rejection，页面停在默认值上——用户改的设置既没读出来也不知为何。
  const runInitialize = useCallback(() => {
    setLoadFailed(false);
    initialize().catch((error: unknown) => {
      logFailure('options', '初始化失败，设置页数据未加载', error);
      setLoadFailed(true);
    });
  }, [initialize]);

  useEffect(() => {
    runInitialize();
  }, [runInitialize]);

  if (loadFailed) return <LoadErrorState onRetry={runInitialize} />;

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
