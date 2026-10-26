import type { ReactNode } from 'react';
import type { TabRecord } from '@/core/tab-types';
import { useTranslation } from '@/i18n';
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
  const badges: ReactNode[] = [];

  if (duplicateCount > 1) {
    badges.push(
      <span
        key="dup"
        className="status-badge status-keep chip rounded bg-warn-100 px-1 text-warn-700"
        title={t('此网址在当前窗口共有 {{count}} 份', { count: duplicateCount })}
      >
        <span aria-hidden="true">{duplicateCount}×</span>
        <span className="sr-only">
          {t('此网址在当前窗口共有 {{count}} 份', { count: duplicateCount })}
        </span>
      </span>
    );
  }

  // 决策徽章（重复 n×、休眠雪花）必须排在次要徽章之前：.row-badges 有 38% 宽度上限，
  // 溢出时裁的是末尾，若雪花的 snowflake 排在第 5 位会第一个被裁掉，
  // 而它恰恰是「要不要唤醒/去重」的判断依据。
  if (tab.discarded) {
    badges.push(
      /* 雪花必须包一层与同组徽章同构的 chip（胶囊底 + px-1）：裸图标并排时高度与
         水平度量都不同，看着像漏渲染。 */
      <span
        key="frozen"
        className="chip status-badge status-keep rounded bg-gray-100 px-1 text-gray-600"
        title={t('已休眠（点击唤醒）')}
        aria-label={t('已休眠（点击唤醒）')}
      >
        <Icon d={Icons.snowflake} className="h-3 w-3" />
      </span>
    );
  }

  if (tab.audible && !tab.muted) {
    badges.push(
      <span
        key="audible"
        className="media-playing-badge status-badge"
        title={t('正在播放媒体声音')}
        aria-label={t('正在播放媒体声音')}
      >
        <Icon d={Icons.volumeOn} className="h-3 w-3" />
        <span>{t('播放中')}</span>
      </span>
    );
  } else if (tab.muted) {
    badges.push(
      /* 与同组徽章同构（rounded + bg + px-1 + font-medium）：「静」若没有
         内边距与底色，并排时高度与水平度量都和邻居不同，像漏渲染。 */
      <span
        key="muted"
        className="status-badge chip chip--cjk rounded bg-gray-100 px-1 text-gray-600"
        title={t('已静音')}
      >
        <span aria-hidden="true">{t('静')}</span>
        <span className="sr-only">{t('已静音')}</span>
      </span>
    );
  }

  if (showSplitBadges && tab.splitViewId !== undefined) {
    badges.push(
      <span
        key="split"
        /* 与「伴」同构（浅底深字）：「拆」用饱和实底会比主信息（标签标题）还抢眼；
           分屏的强调由 data-split-role 的左侧竖线承担。 */
        className="status-badge chip chip--cjk rounded bg-accent-100 px-1 text-accent-700"
        title={t('正在分屏显示')}
      >
        <span aria-hidden="true">{t('拆')}</span>
        <span className="sr-only">{t('正在分屏显示')}</span>
      </span>
    );
  }

  if (isSplitCompanion) {
    badges.push(
      <span
        key="companion"
        className="status-badge chip chip--cjk rounded bg-accent-100 px-1 text-accent-700"
        title={t('与当前标签同屏分屏')}
      >
        <span aria-hidden="true">{t('伴')}</span>
        <span className="sr-only">{t('与当前标签同屏分屏')}</span>
      </span>
    );
  }

  if (noCache) {
    badges.push(
      <span
        key="noCache"
        className="status-badge chip chip--cjk rounded bg-warn-100 px-1 text-warn-700"
        title={t('此站点已设为打开时不使用缓存')}
      >
        <span aria-hidden="true">{t('禁')}</span>
        <span className="sr-only">{t('此站点已设为打开时不使用缓存')}</span>
      </span>
    );
  }

  if (badges.length === 0) return null;
  return <span className="flex shrink-0 items-center gap-1">{badges}</span>;
}
