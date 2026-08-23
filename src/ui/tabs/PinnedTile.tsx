import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { useDomainAccent } from '@/ui/tabs/accent';

/** dnd-kit 排序接入点（顶部永久固定区 PinnedStrip 传入；无排序的场景不传）。 */
interface PinnedTileSortable {
  setNodeRef: (node: HTMLElement | null) => void;
  attributes: object;
  listeners: object | undefined;
  style: CSSProperties;
  isDragging: boolean;
}

/**
 * 固定标签磁贴（浏览器原生固定区 / 顶部永久固定区共用）：
 * 主按钮（单击激活、中键关闭）+ 悬停取消固定 / 复制。
 * 传 `sortable` 时参与 dnd-kit 排序。
 */
export function PinnedTile({
  title,
  favIconUrl,
  url,
  isActive = false,
  isDiscarded = false,
  isAudible = false,
  onClick,
  onMiddleClick,
  onUnpin,
  onDuplicate,
  unpinTitle,
  sortable
}: {
  title: string;
  favIconUrl?: string;
  url?: string;
  isActive?: boolean;
  isDiscarded?: boolean;
  isAudible?: boolean;
  onClick: () => void;
  /** 中键关闭（仅关闭页面，固定入口保留）。 */
  onMiddleClick?: () => void;
  onUnpin?: () => void;
  onDuplicate?: () => void;
  /** 移除按钮文案（默认「取消固定」，永久固定区传「移除固定入口」）。 */
  unpinTitle?: string;
  sortable?: PinnedTileSortable;
}) {
  const { t } = useTranslation();
  // 磁贴主色：优先 favicon（data: URL 可取色）主色，否则域名哈希色——与站点组圆点同源。
  const domain = useMemo(() => {
    if (!url) return undefined;
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  }, [url]);
  const accent = useDomainAccent(favIconUrl, domain);
  const tileClass =
    'pinned-tile' +
    (isActive ? ' is-active' : '') +
    (isDiscarded ? ' is-discarded' : '') +
    (isAudible ? ' is-audible' : '') +
    (sortable?.isDragging ? ' is-dragging' : '');

  return (
    <article
      className={tileClass}
      style={accent ? ({ '--tile-accent': accent } as CSSProperties) : undefined}
    >
      <button
        ref={sortable?.setNodeRef}
        type="button"
        className="pinned-main"
        style={sortable?.style}
        title={title || url}
        aria-label={title || url}
        onClick={onClick}
        onAuxClick={(event) => {
          if (event.button === 1) onMiddleClick?.();
        }}
        {...sortable?.attributes}
        {...sortable?.listeners}
      >
        <span className="pinned-favicon-wrap">
          <Favicon src={favIconUrl} title={title || ''} size={18} />
        </span>
      </button>
      {onUnpin && (
        <button
          type="button"
          className="row-action pinned-unpin"
          title={unpinTitle ?? t('tabs.unpin')}
          aria-label={unpinTitle ?? t('tabs.unpin')}
          onClick={onUnpin}
        >
          <Icon d={Icons.close} className="h-3 w-3" />
        </button>
      )}
      {onDuplicate && (
        <button
          type="button"
          className="row-action pinned-duplicate"
          title={t('tabs.duplicate')}
          aria-label={t('tabs.duplicate')}
          onClick={onDuplicate}
        >
          <Icon d={Icons.copy} className="h-3 w-3" />
        </button>
      )}
    </article>
  );
}
