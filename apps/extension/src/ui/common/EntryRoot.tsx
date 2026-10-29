import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useDataStore } from '@/stores/dataStore';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { LoadErrorState } from '@/ui/common/ListStates';
import { logFailure } from '@/platform/diagnostics';

/**
 * 页面入口的公共根：读取设置，初始化失败时呈现可重试的错误态，成功后渲染内容。
 * 设置页与关于页共用此流程；入口壳只负责组装，初始化逻辑可独立测试。
 */
export function EntryRoot({
  scope,
  layout = 'panel',
  children
}: {
  scope: string;
  /**
   * 失败态的版式：`panel` = 侧边栏（内容区自带边距），`page` = 设置页/关于页
   * （整页需版心与呼吸感）。`EmptyState` 是侧栏尺寸的组件，直接放进整页会贴在
   * 左上角 —— 同一次打开，正常态居中、失败态贴边。
   */
  layout?: 'panel' | 'page';
  children: ReactNode;
}) {
  const initialize = useDataStore((state) => state.initialize);
  const [loadFailed, setLoadFailed] = useState(false);

  // 初始化失败必须可见：`void initialize()` 无人接住时 Promise 变成
  // unhandled rejection，页面停在默认值上——用户改的设置既没读出来也不知为何。
  const runInitialize = useCallback(() => {
    setLoadFailed(false);
    initialize().catch((error: unknown) => {
      logFailure(scope, '初始化失败，页面数据未加载', error);
      setLoadFailed(true);
    });
  }, [initialize, scope]);

  useEffect(() => {
    runInitialize();
  }, [runInitialize]);

  if (loadFailed) {
    const errorState = <LoadErrorState onRetry={runInitialize} />;
    return layout === 'page' ? (
      <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-6 py-10">
        {errorState}
      </div>
    ) : (
      errorState
    );
  }

  return (
    <>
      <SettingsSync />
      {children}
    </>
  );
}
