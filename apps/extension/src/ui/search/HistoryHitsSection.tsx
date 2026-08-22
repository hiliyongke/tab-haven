import { useRef } from 'react';
import { useTranslation } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import type { HistorySearchHit } from '@/ui/search/useSearchController';
import { Icon, Icons } from '@/ui/common/Icon';
import { formatTime } from '@/ui/common/format';
import { useScrollFade } from '@/ui/common/useScrollFade';

/**
 * 历史命中分区：搜索命中快照 / 归档条目时，在标签列表下方
 * 追加「历史命中」区块。每条展示标题命中分段、来源徽标（命名/自动/归档/工作区）、
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

/**
 * 来源徽标的**中文原文**（取值会原样传进 `t()`）。
 *
 * 属性名以 `Key` 结尾是扫描器的抽取约定：写成 `switch` 里直接 `return '空间'` 时，
 * 扫描器只认调用点 / `*Key` 属性 / `<Trans>`，return 的字面量抽不到 ——
 * 「空间」因此始终不在词典里（英文模式露中文），而 check 因为用的是同一份抽取
 * 结果同样给出绿灯。用 `@i18n-ignore` 豁免 zh-linter 也只压住告警、词条照样进不来。
 *
 * 口径与 `SnapshotRow.originBadge` 对齐：space 是「工作区」而不是「空间」。
 */
const ORIGIN_BADGE_LABELS: Record<Snapshot['origin'], { badgeKey: string }> = {
  auto: { badgeKey: '自动快照' },
  archive: { badgeKey: '归档' },
  space: { badgeKey: '工作区' },
  manual: { badgeKey: '命名快照' }
};

function originBadgeKey(origin: HistorySearchHit['snapshotOrigin']): string {
  switch (origin) {
    case 'auto':
      return ORIGIN_BADGE_LABELS.auto.badgeKey;
    case 'archive':
      return ORIGIN_BADGE_LABELS.archive.badgeKey;
    case 'space':
      return ORIGIN_BADGE_LABELS.space.badgeKey;
    default:
      return ORIGIN_BADGE_LABELS.manual.badgeKey;
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
  const listRef = useRef<HTMLUListElement>(null);
  useScrollFade(listRef, hits.length);
  if (hits.length === 0) return null;
  return (
    // 本区块挂在主滚动容器**之外**，是 flex 列的直接子项：刚性高度（最多 20 条 ×
    // 约 40px ≈ 800px）会把主列表压成 0 高并顶走底栏 —— 命中越多界面越崩。
    // 解法是「封顶 + 可收缩」：常态按内容高、最多 40vh（超出在区内滚）；
    // 矮面板下参与收缩让位给主列表（列表本身已有 120px 兜底）。
    // shrink-0 是错的：它让本区永远不让步，把挤压缩小主列表之外的唯一出路堵死。
    <section
      className="mb-1 flex min-h-0 max-h-[40vh] flex-col"
      aria-label={t('历史命中（快照与归档）')}
    >
      <header className="flex shrink-0 items-center gap-1.5 px-2 py-1">
        <Icon d={Icons.history} className="h-3 w-3 shrink-0 text-gray-500" />
        <span className="text-3xs font-medium tracking-wide text-gray-500">
          {t('历史命中（快照与归档）')}
        </span>
        <span className="text-3xs text-gray-500">
          {t('{{count}} 条历史记录', { count: hits.length })}
        </span>
      </header>
      <ul
        ref={listRef}
        // min-h-0 flex-1：高度由外层 section 的 40vh 封顶分配，矮面板下随 section
        // 一起收缩（而不是把父级顶开），超出部分在区内滚。
        className="scroll-fade min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto overscroll-contain rounded-lg border border-gray-100 bg-surface"
      >
        {hits.map((hit) => {
          // 徽标文案与快照名同文时不重复渲染：自动快照的 name 就是「自动快照」原文
          // （与徽标同文），再显示一遍只占宽度、把 URL 挤没。
          const badgeLabel = t(originBadgeKey(hit.snapshotOrigin));
          return (
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
                <p className="mt-px flex min-w-0 items-center gap-1.5 text-3xs text-gray-500">
                  {/* 徽标必须 shrink-0 + nowrap：flex 子项默认可收缩，中文逐字断行
                    会把「自动快照」拆成「自动快 / 照」（窄面板下必现）。 */}
                  <span
                    className={
                      'chip chip--cjk shrink-0 whitespace-nowrap rounded px-1 py-px ' +
                      originBadgeClass(hit.snapshotOrigin)
                    }
                  >
                    {badgeLabel}
                  </span>
                  {/* min-w-0 不可省：flex 子项默认 min-width:auto，在 truncate 的
                      white-space:nowrap 下 min-content = 全文宽度，会顶开右侧
                      shrink-0 的时间与按钮，且优先级高于 max-width。 */}
                  {hit.snapshotName !== badgeLabel && (
                    <span className="min-w-0 truncate">{hit.snapshotName}</span>
                  )}
                  <span className="shrink-0">{formatTime(hit.snapshotCreatedAt)}</span>
                  <span className="min-w-0 max-w-[40%] truncate">{hit.tab.url}</span>
                </p>
              </div>
              <button
                type="button"
                title={t('打开该页面')}
                aria-label={t('打开该页面')}
                // min-h-6/min-w-6（24px）：p-1 + 14px 图标仅 22px，低于 WCAG 2.5.8 下限
                className="grid min-h-6 min-w-6 shrink-0 place-items-center rounded text-gray-500 transition-base hover:bg-accent-50 hover:text-accent-600"
                onClick={() => onOpenUrl(hit.tab.url)}
              >
                <Icon d={Icons.search} className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={t('恢复该快照')}
                aria-label={t('恢复该快照')}
                // min-h-6/min-w-6（24px）：p-1 + 14px 图标仅 22px，低于 WCAG 2.5.8 下限
                className="grid min-h-6 min-w-6 shrink-0 place-items-center rounded text-gray-500 transition-base hover:bg-accent-50 hover:text-accent-600"
                onClick={() => onRestoreSnapshot(hit.snapshotId, hit.snapshotTabCount)}
              >
                <Icon d={Icons.openAll} className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
