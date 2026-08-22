import { useMemo, useRef } from 'react';
import { useTranslation } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import type { SnapshotDiffResult } from '@/core/snapshot/snapshotDiff';
import { Icon, Icons } from '@/ui/common/Icon';
import { TextField } from '@/ui/common/TextField';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { formatTime } from '@/ui/common/format';
import { ContextMenu, useRowContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';

function originBadge(
  origin: string,
  t: (key: string) => string
): { label: string; className: string } {
  switch (origin) {
    case 'auto':
      // gray-600 而非 gray-500：仓库自测 gray-500 在 gray-100 底上仅 3.92:1（不达 AA），
      // gray-600 达 6.8:1（见 main.css .count-pill 注释）。
      return { label: t('自动'), className: 'bg-gray-100 text-gray-600' };
    case 'archive':
      return { label: t('归档'), className: 'bg-warn-100 text-warn-700' };
    case 'space':
      return { label: t('工作区'), className: 'bg-accent-100 text-accent-700' };
    default:
      return { label: t('手动'), className: 'bg-accent-50 text-accent-600' };
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
  /** 恢复预览 diff：展开行时由面板计算并传入；未提供则退回纯清单视图。 */
  diff?: SnapshotDiffResult;
  /** 勾选态：展开条目勾选集（tab url + index 键），由面板持有。 */
  selectedKeys?: ReadonlySet<string>;
  /** 勾选态切换。 */
  onToggleSelected?: (key: string) => void;
  /** 选择性恢复：按当前勾选集恢复；未传则不显示勾选交互。 */
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
  const detailScrollRef = useRef<HTMLUListElement>(null);
  // 详情列表是条件渲染的，必须把开关作为依赖传入，否则容器出现后不会补挂监听
  useScrollFade(detailScrollRef, isDetailOpen);
  /* 右键菜单：快照的删除不可恢复，而行尾只有一排无文字图标（与恢复、重命名相邻），
     误触代价高。右键给出带文字的明确操作列表。 */
  const { menu, open: openMenu, close: closeMenu } = useRowContextMenu();
  const menuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        id: 'restore',
        label: t('恢复'),
        disabled: restoring,
        onSelect: () => void onRestore(snap.id, snap.tabCount)
      },
      {
        id: 'detail',
        label: t('查看快照内标签'),
        onSelect: () => onToggleDetail(snap.id)
      },
      { id: 'rename', label: t('重命名'), onSelect: () => onBeginRename(snap.id, snap.name) },
      { id: 'delete', label: t('删除'), danger: true, onSelect: () => void onDelete(snap.id) }
    ],
    [
      onBeginRename,
      onDelete,
      onRestore,
      onToggleDetail,
      restoring,
      snap.id,
      snap.name,
      snap.tabCount,
      t
    ]
  );
  return (
    <li key={snap.id} className="px-3 py-2" onContextMenu={openMenu}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <TextField
              size="sm"
              value={editingName}
              ariaLabel={t('重命名')}
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
          {/* 容器与文本都要 min-w-0：父级 :71 的 min-w-0 只保证父能收缩，
              本行 span 的 min-content 仍会把内容撑到右侧 shrink-0 的操作组下方。 */}
          {/* 含汉字的正文说明走 11px（text-3xs）：10px 下汉字笔画糊 */}
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-3xs text-gray-500">
            <span
              className={
                'chip chip--cjk shrink-0 rounded px-1 py-px ' +
                originBadge(snap.origin, t).className
              }
            >
              {originBadge(snap.origin, t).label}
            </span>
            <span className="min-w-0 truncate">
              {snap.tabCount} {t('个标签')} · {formatTime(snap.createdAt)}
            </span>
          </span>
        </div>
        {/* gap-1 而非 gap-0.5：四个 24px 按钮中心距仅约 26px 时，连续删除快照
            的误触率明显上升（删除不可逆）。 */}
        <div className="flex shrink-0 items-center gap-1">
          {/* 查看详情：展开快照内的标签清单（恢复前可确认内容） */}
          <button
            type="button"
            title={t('查看快照内标签')}
            aria-label={t('查看快照内标签')}
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
            title={t('恢复')}
            aria-label={t('恢复')}
            disabled={restoring}
            className="rounded p-1 text-gray-500 hover:bg-accent-50 hover:text-accent-600 disabled:opacity-50 disabled:hover:bg-transparent"
            onClick={() => void onRestore(snap.id, snap.tabCount)}
          >
            <Icon d={Icons.openAll} className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t('重命名')}
            aria-label={t('重命名')}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
            onClick={() => onBeginRename(snap.id, snap.name)}
          >
            <Icon d={Icons.pencil} className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t('删除')}
            aria-label={t('删除')}
            /* 删除与「查看详情」「重命名」静默态完全同色同形，无 hover 设备上
               不可分；改为静默中性、hover/focus 转红（与 .row-action.is-danger
               同口径），并扩到 28px 命中区。 */
            className="row-action text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:text-red-600"
            onClick={() => void onDelete(snap.id)}
          >
            <Icon d={Icons.trash} className="h-4 w-4" />
          </button>
        </div>
      </div>
      {isDetailOpen && (
        // 卡片边框改 gray-200：gray-100 对白面仅 1.1:1，边框「隐形」时
        // 卡内 12px 缩进读起来就是无缘无故的错位。
        <div className="mt-1.5 rounded-md border border-gray-200 bg-gray-50">
          {/* 底色不用 /70 合成：浅色下几乎等于父面（层次消失），深色下反而比父面
              更暗（读成凹陷的洞）—— 同一元素在两个主题下语义相反。 */}
          {snap.tabs.length === 0 ? (
            <p className="py-2 text-center text-3xs text-gray-500">{t('该快照没有可恢复的标签')}</p>
          ) : (
            <>
              {diff && (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-gray-100 px-2 py-1.5 text-3xs text-gray-500">
                  <span className="font-medium text-gray-600">
                    {t('预览：将新建 {{create}} · 已存在 {{existing}} · 不恢复 {{skipped}}', {
                      create: diff.counts.create,
                      existing: diff.counts.existing,
                      skipped: diff.counts.skipped
                    })}
                  </span>
                  <span className="text-accent-600">
                    {t('将新建')} {diff.counts.create}
                  </span>
                  <span className="text-gray-500">
                    {t('已存在')} {diff.counts.existing}
                  </span>
                  <span className="text-gray-500">
                    {t('不恢复')} {diff.counts.skipped}
                  </span>
                </p>
              )}
              {/* overscroll-contain：本列表是弹窗内容区（已滚动）内的第二层滚动，
                  不隔离会带动弹窗内容区一起滚并把分组标题顶走。
                  scroll-fade：被 max-h-44 截断，底部渐隐提示「还有更多标签」。 */}
              <ul
                ref={detailScrollRef}
                className="scroll-fade max-h-44 divide-y divide-gray-100 overflow-y-auto overscroll-contain px-2 py-1"
              >
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
                        <Icon d={Icons.pin} className="h-3 w-3 shrink-0 text-gray-500" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-3xs text-gray-700">
                        {tab.title || tab.url}
                      </span>
                      {diff && isExisting && (
                        <span className="chip chip--cjk shrink-0 rounded bg-gray-100 px-1 py-px text-gray-600">
                          {t('已存在')}
                        </span>
                      )}
                      {diff && isSkipped && (
                        <span className="chip chip--cjk shrink-0 rounded bg-gray-100 px-1 py-px text-gray-600">
                          {t('不恢复')}
                        </span>
                      )}
                      {/* min-w-0 不可省：无它时 min-width:auto 会击穿 max-w-[45%]，
                          长 URL 直接撑满并顶开同行元素。 */}
                      <span className="min-w-0 max-w-[45%] truncate text-3xs text-gray-500">
                        {tab.url}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {onRestoreSelected && selectedKeys && (
                <div className="border-t border-gray-100 px-2 py-1.5">
                  <button
                    type="button"
                    disabled={restoring || selectedKeys.size === 0}
                    className="w-full min-h-6 rounded px-2 py-1 text-2xs font-medium text-accent-700 transition-base hover:bg-accent-50 disabled:opacity-50 disabled:hover:bg-transparent"
                    onClick={() => void onRestoreSelected(snap.id, selectedKeys.size)}
                  >
                    {t('恢复勾选（{{count}}）', { count: selectedKeys.size })}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </li>
  );
}
