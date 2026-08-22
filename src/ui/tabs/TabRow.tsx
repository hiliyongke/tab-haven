import type { TabRecord } from '@/core/tab-types';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { StatusBadges } from '@/ui/common/StatusBadges';

/** 拖放数据键（标签 id）。 */
export const TAB_DRAG_MIME = 'application/x-tab-id';

/**
 * 标签行：主按钮（切换/选择）+ 状态徽章 + 悬停操作（静音/固定/关闭）。
 *
 * 交互（行为规格）：
 *  - 普通模式：点击切换；悬停显示行操作；中键关闭；可拖拽（到固定区/文件夹）；
 *  - 选择模式：点击切换选中（shift 连选）、不激活；不响应悬停操作。
 */
export function TabRow({
  tab,
  duplicateCount,
  isActive,
  isSplitCompanion,
  selectionMode,
  selected,
  onActivate,
  onToggleSelect,
  onRangeSelect,
  onToggleMute,
  onTogglePin,
  onClose
}: {
  tab: TabRecord;
  duplicateCount: number;
  isActive: boolean;
  isSplitCompanion: boolean;
  selectionMode: boolean;
  selected: boolean;
  onActivate: (tabId: number) => void;
  onToggleSelect: (tabId: number) => void;
  onRangeSelect: (tabId: number) => void;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onClose: (tab: TabRecord) => void;
}) {
  const handleMainClick = (event: React.MouseEvent) => {
    if (selectionMode) {
      if (event.shiftKey) onRangeSelect(tab.id);
      else onToggleSelect(tab.id);
    } else {
      onActivate(tab.id);
    }
  };

  return (
    <article
      className={
        'group relative flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100' +
        (isActive ? ' bg-gray-100' : '') +
        (isSplitCompanion ? ' bg-blue-50/60' : '') +
        (tab.status === 'discarded' ? ' opacity-60' : '') +
        (selected ? ' ring-1 ring-blue-300' : '')
      }
      onAuxClick={(event) => {
        if (event.button === 1 && !selectionMode) onClose(tab);
      }}
      draggable={!selectionMode}
      onDragStart={(event) => {
        if (selectionMode) return;
        event.dataTransfer.setData(TAB_DRAG_MIME, String(tab.id));
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={handleMainClick}
        title={selectionMode ? undefined : `切换到：${tab.title || ''}`}
      >
        {selectionMode ? (
          <span
            className={
              'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]' +
              (selected ? ' border-blue-500 bg-blue-500 text-white' : ' border-gray-300')
            }
            aria-hidden="true"
          >
            {selected ? '✓' : ''}
          </span>
        ) : (
          <Favicon src={tab.favIconUrl} title={tab.title || ''} />
        )}
        <span className="truncate">{tab.title || '无标题标签页'}</span>
        {tab.pinned && (
          <Icon
            d={Icons.pin}
            className="h-3 w-3 shrink-0 text-blue-500"
            aria-label="已固定"
          />
        )}
      </button>

      {!selectionMode && (
        <>
          <StatusBadges
            tab={tab}
            duplicateCount={duplicateCount}
            isSplitCompanion={isSplitCompanion}
          />
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
            <button type="button" className="row-action" title="关闭标签" onClick={() => onClose(tab)}>
              <Icon d={Icons.close} className="h-3.5 w-3.5" />
            </button>
          </span>
        </>
      )}
    </article>
  );
}
