import type { TabRecord } from '@/core/tab-types';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { StatusBadges } from '@/ui/common/StatusBadges';

/**
 * 标签行：主按钮（切换）+ 状态徽章 + 悬停操作（静音/固定/关闭）。
 *
 * 交互（行为规格）：点击切换；悬停显示行操作；中键关闭。
 */
export function TabRow({
  tab,
  duplicateCount,
  isActive,
  isSplitCompanion,
  onActivate,
  onToggleMute,
  onTogglePin,
  onClose
}: {
  tab: TabRecord;
  duplicateCount: number;
  isActive: boolean;
  isSplitCompanion: boolean;
  onActivate: (tabId: number) => void;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onClose: (tab: TabRecord) => void;
}) {
  return (
    <article
      className={
        'group relative flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100' +
        (isActive ? ' bg-gray-100' : '') +
        (isSplitCompanion ? ' bg-blue-50/60' : '') +
        (tab.status === 'discarded' ? ' opacity-60' : '')
      }
      onAuxClick={(event) => {
        if (event.button === 1) onClose(tab);
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => onActivate(tab.id)}
        title={`切换到：${tab.title || ''}`}
      >
        <Favicon src={tab.favIconUrl} title={tab.title || ''} />
        <span className="truncate">{tab.title || '无标题标签页'}</span>
      </button>

      <StatusBadges tab={tab} duplicateCount={duplicateCount} isSplitCompanion={isSplitCompanion} />

      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {(tab.audible || tab.muted) && (
          <button
            type="button"
            className="row-action"
            title={tab.muted ? '取消静音' : '静音'}
            onClick={() => onToggleMute(tab)}
          >
            <Icon d={tab.muted ? Icons.muted : Icons.mute} className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="row-action"
          title={tab.pinned ? '取消固定' : '固定标签'}
          onClick={() => onTogglePin(tab)}
        >
          <Icon d={Icons.pin} className={'h-3.5 w-3.5' + (tab.pinned ? ' text-blue-500' : '')} />
        </button>
        <button
          type="button"
          className="row-action"
          title="关闭标签"
          onClick={() => onClose(tab)}
        >
          <Icon d={Icons.close} className="h-3.5 w-3.5" />
        </button>
      </span>
    </article>
  );
}
