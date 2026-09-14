import { useTranslation } from 'react-i18next';
import type { HistorySearchHit } from '@/entrypoints/sidepanel/hooks/useSearchController';
import { Icon, Icons } from '@/ui/common/Icon';
import { formatTime } from '@/ui/common/format';

/**
 * 历史命中分区（P-01 时间线搜索）：搜索命中快照/归档条目时，在标签列表下方
 * 追加「历史命中」区块。每条展示标题命中分段、来源徽标（命名/自动/归档/空间）、
 * 快照时间；动作两个：「打开该页面」（仅新建单个标签，最轻量）与
 * 「恢复该快照」（整份恢复，复用快照面板管线）。
 *
 * 刻意放在标签列表**之后**：当前标签永远是第一优先级结果，历史是回溯补充。
 */

/** 来源徽标样式（与 SnapshotsPanel originBadge 同套色板）。 */
function originBadgeClass(origin: HistorySearchHit['snapshotOrigin']): string {
  switch (origin) {
    case 'auto':
      return 'bg-gray-100 text-gray-500';
    case 'archive':
      return 'bg-warn-100 text-warn-700';
    case 'space':
      return 'bg-accent-100 text-accent-700';
    default:
      return 'bg-accent-50 text-accent-600';
  }
}

/** 来源徽标文案键（字面量，死键守卫靠精确键串判定）。 */
function originBadgeKey(origin: HistorySearchHit['snapshotOrigin']): string {
  switch (origin) {
    case 'auto':
      return 'search.historyOriginAuto';
    case 'archive':
      return 'search.historyOriginArchive';
    case 'space':
      return 'search.historyOriginSpace';
    default:
      return 'search.historyOriginManual';
  }
}

interface HistoryHitsSectionProps {
  hits: readonly HistorySearchHit[];
  /** 打开单条 URL（最轻量找回：仅新建一个标签）。 */
  onOpenUrl: (url: string) => void;
  /** 恢复整份快照（复用快照面板恢复管线与提示）。 */
  onRestoreSnapshot: (snapshotId: string, tabCount: number) => void;
}

export function HistoryHitsSection({
  hits,
  onOpenUrl,
  onRestoreSnapshot
}: HistoryHitsSectionProps) {
  const { t } = useTranslation();
  if (hits.length === 0) return null;
  return (
    <section className="mx-1 mb-1" aria-label={t('search.historySection')}>
      <header className="flex items-center gap-1.5 px-2 py-1">
        <Icon d={Icons.history} className="h-3 w-3 shrink-0 text-gray-400" />
        <span className="text-2xs font-medium uppercase tracking-wide text-gray-500">
          {t('search.historySection')}
        </span>
        <span className="text-2xs text-gray-400">
          {t('search.historyHits', { count: hits.length })}
        </span>
      </header>
      {hits.length === 0 && (
        <p className="px-2 py-1 text-2xs text-gray-400">{t('search.historyEmpty')}</p>
      )}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-surface">
        {hits.map((hit) => (
          <li
            key={`${hit.snapshotId}-${hit.tabIndex}`}
            className="group flex min-w-0 items-center gap-1.5 px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-2xs text-gray-700">
                {hit.titleSegments.map((segment, index) =>
                  segment.hit ? (
                    <mark
                      key={index}
                      className="rounded bg-accent-100 px-px font-semibold text-accent-700"
                    >
                      {segment.text}
                    </mark>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  )
                )}
              </p>
              <p className="mt-px flex min-w-0 items-center gap-1.5 text-3xs text-gray-400">
                <span
                  className={
                    'rounded px-1 py-px leading-none ' + originBadgeClass(hit.snapshotOrigin)
                  }
                >
                  {t(originBadgeKey(hit.snapshotOrigin))}
                </span>
                <span className="truncate">{hit.snapshotName}</span>
                <span className="shrink-0">{formatTime(hit.snapshotCreatedAt)}</span>
                <span className="max-w-[40%] truncate">{hit.tab.url}</span>
              </p>
            </div>
            <button
              type="button"
              title={t('search.historyOpenUrl')}
              aria-label={t('search.historyOpenUrl')}
              className="shrink-0 rounded p-1 text-gray-500 transition-base hover:bg-accent-50 hover:text-accent-600"
              onClick={() => onOpenUrl(hit.tab.url)}
            >
              <Icon d={Icons.search} className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={t('search.historyRestoreSnapshot')}
              aria-label={t('search.historyRestoreSnapshot')}
              className="shrink-0 rounded p-1 text-gray-500 transition-base hover:bg-accent-50 hover:text-accent-600"
              onClick={() => onRestoreSnapshot(hit.snapshotId, hit.snapshotTabCount)}
            >
              <Icon d={Icons.openAll} className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
