import { useTranslation } from 'react-i18next';
import type { Snapshot } from '@/core/schema/models';
import type { SnapshotDiffResult } from '@/core/snapshot/snapshotDiff';
import { Icon, Icons } from '@/ui/common/Icon';
import { TextField } from '@/ui/common/TextField';
import { formatTime } from '@/ui/common/format';

function originBadge(
  origin: string,
  t: (key: string) => string
): { label: string; className: string } {
  switch (origin) {
    case 'auto':
      return { label: t('snapshots.auto'), className: 'bg-gray-100 text-gray-500' };
    case 'archive':
      return { label: t('snapshots.archive'), className: 'bg-warn-100 text-warn-700' };
    case 'space':
      return { label: t('snapshots.space'), className: 'bg-accent-100 text-accent-700' };
    default:
      return { label: t('snapshots.manual'), className: 'bg-accent-50 text-accent-600' };
  }
}

interface SnapshotRowProps {
  snap: Snapshot;
  isEditing: boolean;
  editingName: string;
  isDetailOpen: boolean;
  onEditingNameChange: (value: string) => void;
  onBeginRename: (id: string, name: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onToggleDetail: (id: string) => void;
  onRestore: (id: string, tabCount: number) => void;
  onDelete: (id: string) => void;
  /** 恢复执行中：禁用本行恢复按钮，防止双击并发恢复重复打开同一批标签。 */
  restoring?: boolean;
  /** 恢复预览 diff（P-02）：detail 打开时由面板计算并传入；未提供则退回纯清单视图。 */
  diff?: SnapshotDiffResult;
  /** 勾选态（P-02）：detail 条目勾选集（tab url+index 键），由面板持有。 */
  selectedKeys?: ReadonlySet<string>;
  /** 勾选态切换（P-02）。 */
  onToggleSelected?: (key: string) => void;
  /** 选择性恢复（P-02）：按当前勾选集恢复；未传则不显示勾选交互。 */
  onRestoreSelected?: (id: string, tabCount: number) => void;
}

/** 单条快照：命名 / 徽标 / 展开标签清单 / 恢复·改名·删除。 */
export function SnapshotRow({
  snap,
  isEditing,
  editingName,
  isDetailOpen,
  onEditingNameChange,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onToggleDetail,
  onRestore,
  onDelete,
  restoring = false,
  diff,
  selectedKeys,
  onToggleSelected,
  onRestoreSelected
}: SnapshotRowProps) {
  const { t } = useTranslation();
  return (
    <li key={snap.id} className="px-2.5 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <TextField
              size="sm"
              value={editingName}
              ariaLabel={t('snapshots.rename')}
              onChange={onEditingNameChange}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void onCommitRename();
                if (event.key === 'Escape') onCancelRename();
              }}
              onBlur={() => void onCommitRename()}
            />
          ) : (
            <span className="block truncate text-xs font-medium text-gray-700">{snap.name}</span>
          )}
          <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-gray-500">
            <span
              className={
                'rounded px-1 py-px text-2xs leading-none ' + originBadge(snap.origin, t).className
              }
            >
              {originBadge(snap.origin, t).label}
            </span>
            <span>
              {snap.tabCount} {t('tabs.tabCountUnit')} · {formatTime(snap.createdAt)}
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* 查看详情：展开快照内的标签清单（恢复前可确认内容） */}
          <button
            type="button"
            title={t('snapshots.detail')}
            aria-expanded={isDetailOpen}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
            onClick={() => onToggleDetail(snap.id)}
          >
            <Icon
              d={Icons.chevron}
              className={'h-4 w-4 transition-transform' + (isDetailOpen ? ' rotate-90' : '')}
            />
          </button>
          <button
            type="button"
            title={t('snapshots.restore')}
            disabled={restoring}
            className="rounded p-1 text-gray-500 hover:bg-accent-50 hover:text-accent-600 disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => void onRestore(snap.id, snap.tabCount)}
          >
            <Icon d={Icons.openAll} className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t('snapshots.rename')}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
            onClick={() => onBeginRename(snap.id, snap.name)}
          >
            <Icon d={Icons.pencil} className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t('snapshots.delete')}
            className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
            onClick={() => void onDelete(snap.id)}
          >
            <Icon d={Icons.trash} className="h-4 w-4" />
          </button>
        </div>
      </div>
      {isDetailOpen && (
        <div className="mt-1.5 rounded-md border border-gray-100 bg-gray-50/70">
          {snap.tabs.length === 0 ? (
            <p className="py-2 text-center text-2xs text-gray-500">{t('snapshots.empty')}</p>
          ) : (
            <>
              {diff && (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-gray-100 px-2 py-1.5 text-2xs text-gray-500">
                  <span className="font-medium text-gray-600">
                    {t('snapshots.previewSummary', {
                      create: diff.counts.create,
                      existing: diff.counts.existing,
                      skipped: diff.counts.skipped
                    })}
                  </span>
                  <span className="text-accent-600">
                    {t('snapshots.previewWillCreate')} {diff.counts.create}
                  </span>
                  <span className="text-gray-400">
                    {t('snapshots.previewExisting')} {diff.counts.existing}
                  </span>
                  <span className="text-gray-400">
                    {t('snapshots.previewSkipped')} {diff.counts.skipped}
                  </span>
                </p>
              )}
              <ul className="max-h-44 divide-y divide-gray-100 overflow-y-auto px-2 py-1">
                {snap.tabs.map((tab, index) => {
                  const key = `${index}-${tab.url}`;
                  const entry = diff?.willCreate.find(
                    (item) => item.tab.url === tab.url && item.tab.title === tab.title
                  );
                  const isExisting = diff
                    ? Boolean(
                        diff.existing.find(
                          (item) => item.tab.url === tab.url && item.tab.title === tab.title
                        )
                      )
                    : false;
                  const isSkipped = diff ? !entry && !isExisting : false;
                  const checked = selectedKeys ? selectedKeys.has(key) : undefined;
                  return (
                    <li key={key} className="flex min-w-0 items-center gap-1.5 py-1">
                      {onToggleSelected && checked !== undefined && (
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 shrink-0 accent-[var(--c-brand-500)]"
                          checked={checked}
                          aria-label={tab.title || tab.url}
                          onChange={() => onToggleSelected(key)}
                        />
                      )}
                      {tab.pinned && (
                        <Icon d={Icons.pin} className="h-3 w-3 shrink-0 text-gray-400" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-2xs text-gray-700">
                        {tab.title || tab.url}
                      </span>
                      {diff && isExisting && (
                        <span className="shrink-0 rounded bg-gray-100 px-1 py-px text-3xs leading-none text-gray-500">
                          {t('snapshots.previewExisting')}
                        </span>
                      )}
                      {diff && isSkipped && (
                        <span className="shrink-0 rounded bg-gray-100 px-1 py-px text-3xs leading-none text-gray-400">
                          {t('snapshots.previewSkipped')}
                        </span>
                      )}
                      <span className="max-w-[45%] truncate text-3xs text-gray-400">{tab.url}</span>
                    </li>
                  );
                })}
              </ul>
              {onRestoreSelected && selectedKeys && (
                <div className="border-t border-gray-100 px-2 py-1.5">
                  <button
                    type="button"
                    disabled={restoring || selectedKeys.size === 0}
                    className="w-full rounded px-2 py-1 text-2xs font-medium text-accent-700 transition-base hover:bg-accent-50 disabled:opacity-40 disabled:hover:bg-transparent"
                    onClick={() => void onRestoreSelected(snap.id, selectedKeys.size)}
                  >
                    {t('snapshots.restoreSelected', { count: selectedKeys.size })}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
