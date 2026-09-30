import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TabRecord } from '@/core/tab-types';
import { hostnameOf } from '@/core/url/UrlInspector';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import type {
  OtherWindow,
  OtherWindowsStatus
} from '@/entrypoints/sidepanel/hooks/useOtherWindows';

/**
 * 其他窗口分段（A4）：主体列表之下的只读浏览 + 聚焦/关闭。
 *
 * 刻意不复用 SectionList / TabRow：那套是「当前窗口全交互」组件（拖拽、
 * 排序、右键、行内操作全开），其他窗口只提供「看一眼、跳过去、关掉」。
 * 域名分桶是纯展示归组（Map 一遍），不引入 computeSections 的全套契约。
 *
 * 三态（loading / error / 空）必须显式：此前该段在数据在途或查询持续失败时
 * 渲染成永久空白，用户无法区分「没有其他窗口」与「加载失败」。status 由
 * useOtherWindows 提供，error 态给重试出口。
 */
export function OtherWindowsSection({
  otherWindows,
  status = 'ready',
  onRetry,
  onFocusTab,
  onCloseTab
}: {
  otherWindows: readonly OtherWindow[];
  /** 查询态；默认 ready 以兼容无状态来源的调用方。 */
  status?: OtherWindowsStatus;
  onRetry?: () => void;
  onFocusTab: (tab: TabRecord) => void;
  onCloseTab: (tab: TabRecord) => void;
}) {
  const { t } = useTranslation();

  /** 域名分桶（纯展示归组；非领域决策故留在组件内）。 */
  const bucketsByWindow = useMemo(
    () =>
      otherWindows.map((win) => {
        const byHost = new Map<string, TabRecord[]>();
        for (const tab of win.tabs) {
          // 主机名解析走 core/url 唯一实现（不另写 URL 解析）。
          const key = hostnameOf(tab.url) || t('windows.ungrouped');
          const list = byHost.get(key);
          if (list) list.push(tab);
          else byHost.set(key, [tab]);
        }
        return { win, buckets: [...byHost.entries()] };
      }),
    [otherWindows, t]
  );

  // 错误态优先于「有数据」：失败时 otherWindows 可能是上一次成功的旧快照，
  // 直接渲染会让人误以为列表是最新的。
  if (status === 'error') {
    return (
      <section className="mt-1">
        <p className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-gray-500">
          {t('windows.sectionLabel')}
        </p>
        <div
          role="alert"
          className="mx-1 mb-1.5 flex items-start gap-2 rounded-lg border border-warn-200 bg-warn-50 px-2.5 py-2"
        >
          <Icon d={Icons.infoAlert} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-600" />
          <div className="min-w-0 flex-1">
            <p className="text-3xs leading-relaxed text-warn-700">{t('windows.loadFailed')}</p>
            {onRetry && (
              <button
                type="button"
                className="mt-1 rounded font-medium text-3xs text-warn-700 underline underline-offset-2 transition-base hover:bg-warn-100"
                onClick={onRetry}
              >
                {t('errors.retry')}
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  // 首帧在途：给骨架占位，避免「正在查」被误读成「没有其他窗口」。
  if (status === 'loading') {
    return (
      <section className="mt-1">
        <p className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-gray-500">
          {t('windows.sectionLabel')}
        </p>
        <div className="mx-1 mb-1.5 rounded-lg border border-gray-100 bg-surface px-2.5 py-2">
          <span className="skeleton block h-3 w-24" />
          <span className="skeleton mt-1.5 block h-3 flex-1" />
          <span className="skeleton mt-1.5 block h-3 w-2/3" />
        </div>
      </section>
    );
  }

  if (otherWindows.length === 0) return null;

  return (
    // 不设 aria-label：下方可见标题已提供可访问名，重复会二次播报。
    <section className="mt-1">
      <p className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-gray-500">
        {t('windows.sectionLabel')}
      </p>
      {bucketsByWindow.map(({ win, buckets }) => (
        <div key={win.windowId} className="mx-1 mb-1.5">
          <p className="flex items-center gap-1.5 px-1.5 pb-1 pt-1.5">
            <span className="text-2xs font-bold text-gray-500">
              {t('windows.windowLabel', { count: win.tabs.length })}
            </span>
            {win.hasActive && (
              <span className="rounded-full bg-accent-100 px-1.5 text-2xs text-accent-700">
                {t('windows.hasActive')}
              </span>
            )}
          </p>
          {buckets.map(([host, tabs]) => (
            <div
              key={host}
              className="mb-1 rounded-lg border border-gray-100 bg-surface"
              role="group"
              aria-label={host}
            >
              <p className="flex items-center gap-1 px-2.5 pb-0.5 pt-1.5 text-2xs font-medium text-gray-400">
                {host}
                <span className="text-gray-300">·</span>
                <span>{tabs.length}</span>
              </p>
              {tabs.map((tab) => (
                <div key={tab.id} className="flex min-w-0 items-center gap-1.5 px-2.5 py-1">
                  <Favicon src={tab.favIconUrl} title={tab.title || tab.url || ''} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-3xs text-gray-700 hover:text-accent-700"
                    title={t('windows.focusTab')}
                    onClick={() => onFocusTab(tab)}
                  >
                    {tab.title || tab.url}
                    {tab.active && (
                      <span className="ml-1 rounded bg-accent-100 px-1 text-2xs text-accent-700">
                        {t('windows.active')}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    title={t('windows.closeTab')}
                    aria-label={t('windows.closeTab')}
                    onClick={() => onCloseTab(tab)}
                  >
                    <Icon d={Icons.close} className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
