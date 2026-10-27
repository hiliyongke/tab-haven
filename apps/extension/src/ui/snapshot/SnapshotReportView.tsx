import { useTranslation } from '@/i18n';
import type { computeInsights } from '@/core/insights/tabInsights';
import { InsightActionButton, TextButton } from '@/ui/snapshot/snapshotButtons';

/** 习惯洞察区块的锚点 id：底栏洞察入口直达后滚动定位到这里。 */
export const INSIGHTS_ANCHOR_ID = 'snapshots-insights';

/**
 * 周报视图：本周统计 + 习惯洞察。
 *
 * 从面板拆出的原因：它是纯展示（统计卡片 + 三组洞察 + 三个行动出口），不含任何
 * 快照读写；与列表/导入/三个确认弹窗同处一个组件时，改一条洞察文案要在 699 行里
 * 跨三段 JSX 定位。
 */
export function SnapshotReportView({
  stats,
  insights,
  onCleanDuplicates,
  onDiscardInactive,
  onArchiveWindow,
  onBack
}: {
  stats: { snapCount: number; archives: number; spaces: number; tabs: number };
  insights: ReturnType<typeof computeInsights>;
  onCleanDuplicates: () => void;
  onDiscardInactive: () => void;
  onArchiveWindow: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-3xs text-gray-600">{t('本地聚合，不涉及任何网络或账号')}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
          <p className="text-base font-semibold text-gray-800">{stats.snapCount}</p>
          {/* 这个数字**已包含**下面「归档」「工作区」两类（同一批数据的三种切片），
              并排会让人误以为三者相加才是总数，故标签必须点明「总数」语义。 */}
          <p className="text-3xs text-gray-500">{t('本周快照总数（含下面两类）')}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
          <p className="text-lg font-semibold text-gray-800">{stats.archives}</p>
          <p className="text-3xs text-gray-500">{t('归档')}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
          <p className="text-lg font-semibold text-gray-800">{stats.spaces}</p>
          <p className="text-3xs text-gray-500">{t('工作区')}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
          <p className="text-lg font-semibold text-gray-800">{stats.tabs}</p>
          <p className="text-3xs text-gray-500">{t('累计归档标签')}</p>
        </div>
      </div>
      {/* 习惯洞察：从当前窗口实时推导行动建议，全部本地计算。
          出口指向已有动作（清理重复 / 一键休眠 / 归档窗口），形成闭环。 */}
      <div
        id={INSIGHTS_ANCHOR_ID}
        tabIndex={-1}
        className="flex flex-col gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2.5"
      >
        <p className="text-2xs font-semibold text-accent-700">{t('习惯洞察')}</p>
        <p className="text-3xs leading-relaxed text-accent-700/90">
          {t('全部本地计算，零上报——从当前窗口实时推导的行动建议')}
        </p>
        {insights.duplicateHotspots.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-3xs font-medium text-gray-600">{t('重复重灾区')}</p>
            {insights.duplicateHotspots.map((hotspot) => (
              <p key={hotspot.host} className="text-3xs text-gray-600">
                <span className="font-medium text-gray-800">{hotspot.host}</span>
                {' · '}
                {t('{{count}} 个重复标签', { count: hotspot.count })}
              </p>
            ))}
            <InsightActionButton onClick={onCleanDuplicates}>
              {t('清理重复标签')}
            </InsightActionButton>
          </div>
        )}
        {insights.discardableCount > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-3xs font-medium text-gray-600">{t('休眠候选')}</p>
            <p className="text-3xs text-gray-600">
              {t('{{count}} 个标签可安全休眠（已休眠 {{discarded}} 个）', {
                count: insights.discardableCount,
                discarded: insights.discardedCount
              })}
            </p>
            <InsightActionButton onClick={onDiscardInactive}>{t('一键休眠')}</InsightActionButton>
          </div>
        )}
        {insights.staleTabs.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-3xs font-medium text-gray-600">{t('滞留预警（超过 7 天未激活）')}</p>
            {insights.staleTabs.map((stale) => (
              <p key={stale.id} className="text-3xs text-gray-600">
                <span className="font-medium text-gray-800">{stale.label}</span>
                {' · '}
                {t('已滞留 {{days}} 天', { days: stale.days })}
              </p>
            ))}
            <InsightActionButton onClick={onArchiveWindow}>{t('归档当前窗口')}</InsightActionButton>
          </div>
        )}
        {insights.duplicateHotspots.length === 0 &&
          insights.discardableCount === 0 &&
          insights.staleTabs.length === 0 && (
            <p className="text-3xs text-gray-600">
              {t('窗口状态很健康：没有重复、无需休眠、也没有滞留标签')}
            </p>
          )}
      </div>
      <TextButton className="self-start" onClick={onBack}>
        {t('取消')}
      </TextButton>
    </div>
  );
}
