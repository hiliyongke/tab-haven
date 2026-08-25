import type { TabRecord } from '@/core/tab-types';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from '@/ui/common/Icon';

/** 标签行状态徽章（n× 重复 / 静音 / 拆分指示）。 */
export function StatusBadges({
  tab,
  duplicateCount,
  isSplitCompanion,
  showSplitBadges = true
}: {
  tab: TabRecord;
  duplicateCount: number;
  isSplitCompanion: boolean;
  /** 是否显示分屏「拆 / 伴」标记。 */
  showSplitBadges?: boolean;
}) {
  const { t } = useTranslation();
  const badges: React.ReactNode[] = [];

  if (duplicateCount > 1) {
    badges.push(
      <span
        key="dup"
        className="rounded bg-warn-100 px-1 text-[10px] font-medium text-warn-700"
        title={t('status.duplicateTitle', { count: duplicateCount })}
      >
        {duplicateCount}×
      </span>
    );
  }

  if (tab.audible && !tab.muted) {
    badges.push(
      <span
        key="audible"
        className="media-playing-badge"
        title={t('status.audible')}
        aria-label={t('status.audible')}
      >
        <Icon d={Icons.mute} className="h-3 w-3" />
        <span>{t('status.playing')}</span>
      </span>
    );
  } else if (tab.muted) {
    badges.push(
      <span key="muted" className="text-[10px] text-gray-500" title={t('status.muted')}>
        {t('status.mutedGlyph')}
      </span>
    );
  }

  if (showSplitBadges && tab.splitViewId !== undefined) {
    badges.push(
      <span
        key="split"
        className="rounded bg-accent-500 px-1 text-[10px] font-medium text-on-accent"
        title={t('status.split')}
      >
        {t('status.splitGlyph')}
      </span>
    );
  }

  if (isSplitCompanion) {
    badges.push(
      <span
        key="companion"
        className="rounded bg-accent-100 px-1 text-[10px] font-medium text-accent-700"
        title={t('status.companion')}
      >
        {t('status.companionGlyph')}
      </span>
    );
  }

  if (tab.discarded) {
    badges.push(
      <Icon
        key="frozen"
        d={Icons.snowflake}
        className="h-3 w-3 text-gray-400"
        title={t('status.discarded')}
      />
    );
  }

  if (badges.length === 0) return null;
  return <span className="flex shrink-0 items-center gap-1">{badges}</span>;
}
