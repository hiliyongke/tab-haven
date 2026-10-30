import { useMemo } from 'react';
import { useTranslation } from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import { hostnameOf } from '@/core/url/UrlInspector';
import { Button } from '@/ui/common/Button';
import { Callout } from '@/ui/common/Callout';
import { Chip } from '@/ui/common/Chip';
import { Favicon } from '@/ui/common/Favicon';
import { Icons } from '@/ui/common/Icon';
import { RowActionButton } from '@/ui/common/RowActionButton';
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
  /** 查询态：**必填**，由编译器兜住三态显式传递；给默认值会让「查询失败」被伪装成「没有其他窗口」。 */
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
        <p className="group-label px-2 pb-1 pt-2">{t('其他窗口')}</p>
        <Callout role="alert" tone="warn" className="mb-1.5" icon={Icons.infoAlert}>
          <p className="text-3xs leading-relaxed">
            {t('其他窗口暂时读不出来（浏览器查询失败）。标签数据不受影响，可重试。')}
          </p>
          {/* 告警色文字按钮：配色由 warn-ghost 变体承担，命中下限由 size=dense 承担。 */}
          {onRetry && (
            <Button
              variant="warn-ghost"
              size="dense"
              className="mt-1 underline underline-offset-2"
              onClick={onRetry}
            >
              {t('重试')}
            </Button>
          )}
        </Callout>
      </section>
    );
  }

  // 首帧在途：给骨架占位，避免「正在查」被误读成「没有其他窗口」。
  if (status === 'loading') {
    return (
      // role=status + aria-busy：读屏用户得到「正在查询」反馈，与空态/错误态三态对读屏同形的问题一并解决。
      <section className="mt-1" role="status" aria-busy="true">
        <p className="group-label px-2 pb-1 pt-2">{t('其他窗口')}</p>
        <span className="sr-only">{t('正在查询其他窗口…')}</span>
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
      <p className="group-label px-2 pb-1 pt-2">{t('其他窗口')}</p>
      {/* 窗口卡使用满宽布局，内部 px-2 让内容与全局 8px 竖线对齐。 */}
      {bucketsByWindow.map(({ win, buckets }) => (
        <div key={win.windowId} className="mb-1.5">
          <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5">
            <span className="text-2xs font-semibold text-gray-500">
              {t('窗口 · {{count}} 个标签', { count: win.tabs.length })}
            </span>
            {win.hasActive && (
              <Chip tone="accent" size="md">
                {t('含激活标签')}
              </Chip>
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
                {/* 纯装饰分隔符：读屏会把「·」念成「间隔号」，此处无语义 */}
                <span className="text-gray-400" aria-hidden="true">
                  ·
                </span>
                <span>{tabs.length}</span>
              </p>
              {tabs.map((tab) => (
                <div key={tab.id} className="flex min-w-0 items-center gap-1.5 px-2 py-1">
                  <Favicon pageUrl={tab.url} title={tab.title || tab.url || ''} />
                  <Button
                    variant="ghost"
                    size="dense"
                    className="min-w-0 flex-1 justify-start truncate px-0 py-0 text-left text-3xs text-gray-700 hover:text-accent-700"
                    tooltip={t('聚焦该标签（切到它所在窗口）')}
                    onClick={() => onFocusTab(tab)}
                  >
                    {tab.title || tab.url}
                    {tab.active && (
                      <Chip tone="accent" className="ml-1">
                        {t('激活')}
                      </Chip>
                    )}
                  </Button>
                  {/* 拉到当前窗口：「聚焦」会把浏览器窗口焦点跳走、侧边栏上下文跟着
                      切换，用户容易迷失，因此跨窗口整理必须另给一条不切焦点的路径。 */}
                  {onPullToWindow && (
                    <RowActionButton
                      icon={Icons.layers}
                      label={t('拉到当前窗口')}
                      className="shrink-0"
                      onClick={() => onPullToWindow(tab)}
                    />
                  )}
                  {/* 危险态统一走 .row-action.is-danger（见 main.css）：手写 hover 红是同语义的第二份实现，
                      且静默态 2.68:1 低于非文本的 3:1、命中区只有 18px。 */}
                  <RowActionButton
                    icon={Icons.close}
                    label={t('关闭该标签')}
                    danger
                    /* 12px 图标与左侧「拉到当前窗口」的 14px 图标形成视觉层级。 */
                    iconClass="h-3 w-3"
                    className="shrink-0"
                    onClick={() => onCloseTab(tab)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
