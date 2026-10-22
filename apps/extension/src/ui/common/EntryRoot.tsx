import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useDataStore } from '@/stores/dataStore';
import { SettingsSync } from '@/ui/common/SettingsSync';
import { LoadErrorState } from '@/ui/common/ListStates';
import { logFailure } from '@/platform/diagnostics';

/**
 * 页面入口的公共根：读设置 → 失败可见可重试 → 成功渲染内容。
 *
 * 曾以 `OptionsRoot` / `AboutRoot` 两份近似复制的形式写在各入口的 main.tsx
 * 里，带来两个问题：
 *  1. 入口壳里沉淀了逻辑（违反「entrypoints 只组装」的分层红线），而入口壳被
 *     覆盖率 exclude 排除 —— 这段「初始化失败要可见」的处理从未被任何测试覆盖；
 *  2. 两份复制只在 scope 与子组件上不同，改一处失败处理（如加重试次数）会漏另一处。
 *
 * 收口到这里之后：逻辑可测、两处入口共享同一实现、main.tsx 只剩 render。
 */
export function EntryRoot({ scope, children }: { scope: string; children: ReactNode }) {
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

  if (loadFailed) return <LoadErrorState onRetry={runInitialize} />;

  return (
    <>
      <SettingsSync />
      {children}
    </>
  );
}
