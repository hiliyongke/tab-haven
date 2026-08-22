import { useTranslation } from 'react-i18next';
import type { TabRecord } from '@/core/tab-types';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 固定标签磁贴（浏览器原生固定区 / 固定空间共用）：
 * 主按钮（单击激活、中键关闭）+ 悬停取消固定 / 复制。
 */
export function PinnedTile({
  tab,
  onActivate,
  onTogglePin,
  onClose,
  onDuplicate
}: {
  tab: TabRecord;
  onActivate: (tabId: number) => void;
  onTogglePin: (tab: TabRecord) => void;
  /** 中键关闭。 */
  onClose?: (tab: TabRecord) => void;
  onDuplicate?: (tab: TabRecord) => void;
}) {
  const { t } = useTranslation();
  const tileClass =
    'pinned-tile' +
    (tab.active ? ' is-active' : '') +
    (tab.discarded ? ' is-discarded' : '') +
    (tab.audible ? ' is-audible' : '');

  return (
    <article className={tileClass} data-tabhaven-tab-id={tab.id}>
      <button
        type="button"
        className="pinned-main"
        title={tab.title || tab.url}
        aria-label={tab.title || tab.url}
        onClick={() => onActivate(tab.id)}
        onAuxClick={(event) => {
          if (event.button === 1) onClose?.(tab);
        }}
      >
        <span className="pinned-favicon-wrap">
          <Favicon src={tab.favIconUrl} title={tab.title || ''} size={18} />
        </span>
      </button>
      <button
        type="button"
        className="row-action pinned-unpin"
        title={t('tabs.unpin')}
        aria-label={t('tabs.unpin')}
        onClick={() => onTogglePin(tab)}
      >
        <Icon d={Icons.close} className="h-3 w-3" />
      </button>
      {onDuplicate && (
        <button
          type="button"
          className="row-action pinned-duplicate"
          title={t('tabs.duplicate')}
          aria-label={t('tabs.duplicate')}
          onClick={() => onDuplicate(tab)}
        >
          <Icon d={Icons.copy} className="h-3 w-3" />
        </button>
      )}
    </article>
  );
}
