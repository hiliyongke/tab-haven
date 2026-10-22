import { useMemo } from 'react';
import { useTranslation } from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import { hostnameOf } from '@/core/url/UrlInspector';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import type { OtherWindow, OtherWindowsStatus } from '@/ui/tabs/useOtherWindows';

/**
 * 其他窗口分段（A4）：主体列表之下的只读浏览 + 聚焦/关闭。
 *
 * 刻意不复用 SectionList / TabRow：那套是「当前窗口全交互」组件（拖拽、
 * 排序、右键、行内操作全开），其他窗口只提供「看一眼、跳过去、关掉」。
 * 域名分桶是纯展示归组（Map 一遍），不引入 computeSections 的全套契约。
 *
 * 三态（loading / error / 空）必须显式：数据在线或查询持续失败时若渲染成空白，
 * 用户无法区分「没有其他窗口」与「加载失败」。status 由
 * useOtherWindows 提供，error 态给重试出口。
 */
export function OtherWindowsSection({
  otherWindows,
  status,
  onRetry,
  onFocusTab,
  onCloseTab,
  onPullToWindow
}: {
  otherWindows: readonly OtherWindow[];
  /**
   * 查询态：**必填**。
   *
   * 此前给了 `= 'ready'` 默认值（注释说「以兼容无状态来源的调用方」），而全仓
   * 唯一调用点早已显式传值 —— 这个默认值没有任何真实消费方，却把「三态必须显式」
   * 降级成可选：将来任何新增调用方忘了传，组件会静默以 ready 渲染旧快照或空列表，
   * 把「查询一直失败」伪装成「没有其他窗口」。改为必填后由编译器兜住。
   */
  status: OtherWindowsStatus;
  onRetry?: () => void;
  onFocusTab: (tab: TabRecord) => void;
  onCloseTab: (tab: TabRecord) => void;
  /** 把该标签搬进当前窗口（可选：当前窗口 id 拿不到时不提供该入口）。 */
  onPullToWindow?: (tab: TabRecord) => void;
}) {
  const { t } = useTranslation();

  /** 域名分桶（纯展示归组；非领域决策故留在组件内）。 */
  const bucketsByWindow = useMemo(
    () =>
      otherWindows.map((win) => {
        const byHost = new Map<string, TabRecord[]>();
        for (const tab of win.tabs) {
          // 主机名解析走 core/url 唯一实现（不另写 URL 解析）。
          const key = hostnameOf(tab.url) || t('其他');
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
          {t('其他窗口')}
        </p>
        <div
          role="alert"
          className="mb-1.5 flex items-start gap-2 rounded-lg border border-warn-200 bg-warn-50 px-2.5 py-2"
        >
          <Icon d={Icons.infoAlert} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-600" />
          <div className="min-w-0 flex-1">
            <p className="text-3xs leading-relaxed text-warn-700">
              {t('其他窗口暂时读不出来（浏览器查询失败）。标签数据不受影响，可重试。')}
            </p>
            {onRetry && (
              <button
                type="button"
                className="mt-1 rounded font-medium text-3xs text-warn-700 underline underline-offset-2 transition-base hover:bg-warn-100"
                onClick={onRetry}
              >
                {t('重试')}
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
          {t('其他窗口')}
        </p>
        <div className="mb-1.5 rounded-lg border border-gray-100 bg-surface px-2.5 py-2">
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
        {t('其他窗口')}
      </p>
      {/* 窗口卡不再 mx-1 内缩：内缩 4px 后其内部内容的竖线必然偏离全局 8px，
          改为满宽卡（与 .section-card 同一语言）+ 内部 px-2，内容落在 8px 竖线上。 */}
      {bucketsByWindow.map(({ win, buckets }) => (
        <div key={win.windowId} className="mb-1.5">
          <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5">
            <span className="text-2xs font-semibold text-gray-500">
              {t('窗口 · {{count}} 个标签', { count: win.tabs.length })}
            </span>
            {win.hasActive && (
              <span className="rounded-full bg-accent-100 px-1.5 text-2xs text-accent-700">
                {t('含激活标签')}
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
              <p className="flex items-center gap-1 px-2 pb-0.5 pt-1.5 text-3xs font-medium text-gray-500">
                {host}
                <span className="text-gray-400">·</span>
                <span>{tabs.length}</span>
              </p>
              {tabs.map((tab) => (
                <div key={tab.id} className="flex min-w-0 items-center gap-1.5 px-2 py-1">
                  <Favicon pageUrl={tab.url} title={tab.title || tab.url || ''} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-3xs text-gray-700 hover:text-accent-700"
                    title={t('聚焦该标签（切到它所在窗口）')}
                    onClick={() => onFocusTab(tab)}
                  >
                    {tab.title || tab.url}
                    {tab.active && (
                      <span className="ml-1 rounded bg-accent-100 px-1 text-2xs text-accent-700">
                        {t('激活')}
                      </span>
                    )}
                  </button>
                  {/* 拉到当前窗口：「聚焦」会把浏览器窗口焦点跳走、侧边栏上下文跟着
                      切换，用户容易迷失，因此跨窗口整理必须另给一条不切焦点的路径。 */}
                  {onPullToWindow && (
                    <button
                      type="button"
                      className="row-action shrink-0"
                      title={t('拉到当前窗口')}
                      aria-label={t('拉到当前窗口')}
                      onClick={() => onPullToWindow(tab)}
                    >
                      <Icon d={Icons.layers} className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    /* 中性底 + 红字的预警强度只有标准 .row-action.is-danger 的一半，
                       且命中区仅 18px（低于 24px 下限）。 */
                    className="row-action shrink-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    title={t('关闭该标签')}
                    aria-label={t('关闭该标签')}
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
