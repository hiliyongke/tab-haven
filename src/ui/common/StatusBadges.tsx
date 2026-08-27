import type { TabRecord } from '@/core/tab-types';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 标签行状态徽章（n× 重复 / 静音 / 拆分指示）。
 *
 * 可达性约定：徽章主体是单字符图标（如「拆」「伴」），仅靠 title 无法让读屏
 * 稳定播报（title 在无 role 的 <span> 上只是兜底）。统一改为
 * 「可见字符 aria-hidden + sr-only 全量文案」，保证视觉紧凑且语义完整。
 * 字号统一走 text-2xs 令牌，不再散写任意值字号。
 */
export function StatusBadges({
  tab,
  duplicateCount,
  isSplitCompanion,
  showSplitBadges = true,
  noCache = false
}: {
  tab: TabRecord;
  duplicateCount: number;
  isSplitCompanion: boolean;
  /** 是否显示分屏「拆 / 伴」标记。 */
  showSplitBadges?: boolean;
  /** 是否命中「开发者禁缓存」规则。 */
  noCache?: boolean;
}) {
  const { t } = useTranslation();
  const badges: React.ReactNode[] = [];

  if (duplicateCount > 1) {
    badges.push(
      <span
        key="dup"
        className="rounded bg-warn-100 px-1 text-2xs font-medium text-warn-700"
        title={t('status.duplicateTitle', { count: duplicateCount })}
      >
        <span aria-hidden="true">{duplicateCount}×</span>
        <span className="sr-only">{t('status.duplicateTitle', { count: duplicateCount })}</span>
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
      <span key="muted" className="text-2xs text-gray-500" title={t('status.muted')}>
        <span aria-hidden="true">{t('status.mutedGlyph')}</span>
        <span className="sr-only">{t('status.muted')}</span>
      </span>
    );
  }

  if (showSplitBadges && tab.splitViewId !== undefined) {
    badges.push(
      <span
        key="split"
        className="rounded bg-accent-500 px-1 text-2xs font-medium text-on-accent"
        title={t('status.split')}
      >
        <span aria-hidden="true">{t('status.splitGlyph')}</span>
        <span className="sr-only">{t('status.split')}</span>
      </span>
    );
  }

  if (isSplitCompanion) {
    badges.push(
      <span
        key="companion"
        className="rounded bg-accent-100 px-1 text-2xs font-medium text-accent-700"
        title={t('status.companion')}
      >
        <span aria-hidden="true">{t('status.companionGlyph')}</span>
        <span className="sr-only">{t('status.companion')}</span>
      </span>
    );
  }

  if (tab.discarded) {
    badges.push(
      <Icon
        key="frozen"
        d={Icons.snowflake}
        className="h-3 w-3 text-gray-500"
        title={t('status.discarded')}
      />
    );
  }

  if (noCache) {
    badges.push(
      <span
        key="noCache"
        className="rounded bg-warn-100 px-1 text-2xs font-medium text-warn-700"
        title={t('status.noCacheTitle')}
      >
        <span aria-hidden="true">{t('status.noCacheGlyph')}</span>
        <span className="sr-only">{t('status.noCacheTitle')}</span>
      </span>
    );
  }

  if (badges.length === 0) return null;
  return <span className="flex shrink-0 items-center gap-1">{badges}</span>;
}
