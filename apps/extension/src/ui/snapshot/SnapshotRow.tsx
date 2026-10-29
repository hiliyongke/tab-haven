import { useMemo, useRef } from 'react';
import { isImeComposing } from '@/core/util/keyboard';
import { useTranslation } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import type { SnapshotDiffResult } from '@/core/snapshot/snapshotDiff';
import { Button } from '@/ui/common/Button';
import { Chip } from '@/ui/common/Chip';
import { Checkbox } from '@/ui/common/Checkbox';
import { CollapseChevron } from '@/ui/common/CollapseChevron';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowActionButton } from '@/ui/common/RowActionButton';
import { TextField } from '@/ui/common/TextField';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { formatTime } from '@/ui/common/format';
import { snapshotOriginBadge } from '@/ui/snapshot/snapshotOrigin';
import { ContextMenu, useRowContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';

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

/**
 * diff 条目的匹配键（url 与 title 同时相等）。
 *
 * 分隔符用 `\u0000`：URL 与标题都可含任意可见字符，用可见分隔符会出现
 * 「a + bc」与「ab + c」撞键，把不存在的条目判成已存在。
 */
function diffEntryKey(tab: { url: string; title?: string }): string {
  return `${tab.url}\u0000${tab.title ?? ''}`;
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
  /**
   * 展开清单的 diff 查表：把 willCreate / existing 预建成 Set，行内查表 O(1)。
   *
   * 预建 Set 把行内查表从 O(条目数 × diff 条目数) 降到 O(1)：单份数百条标签时，
   * 朴素双循环展开一份即数万次比较，连点展开/收起会掉帧。键为 diffEntryKey（url + title）。
   */
  const diffIndex = useMemo(() => {
    if (!diff) return undefined;
    const willCreate = new Set<string>();
    for (const item of diff.willCreate) willCreate.add(diffEntryKey(item.tab));
    const existing = new Set<string>();
    for (const item of diff.existing) existing.add(diffEntryKey(item.tab));
    return { willCreate, existing };
  }, [diff]);

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
    // key 由父级（SnapshotsPanel 的 group.items.map）下发，根节点自带的 key 是死值
    <li className="px-3 py-2" onContextMenu={openMenu}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <TextField
              size="sm"
              value={editingName}
              ariaLabel={t('重命名')}
              onChange={onEditingNameChange}
              onKeyDown={(event) => {
                // 输入法组合中的 Enter/Esc 是选词与取消候选，不提交/不取消重命名。
                if (isImeComposing(event)) return;
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
            {/* 同一渲染内只取一次：originBadge 每次调用都会新建对象并跑一次查表。 */}
            {(() => {
              const badge = snapshotOriginBadge(snap.origin);
              return (
                <Chip cjk tone={badge.tone} className="shrink-0 py-px">
                  {t(badge.labelKey)}
                </Chip>
              );
            })()}
            <span className="min-w-0 truncate">
              {snap.tabCount} {t('个标签')} · {formatTime(snap.createdAt)}
            </span>
          </span>
        </div>
        {/* gap-1 而非 gap-0.5：四个 24px 按钮中心距仅约 26px 时，连续删除快照
            的误触率明显上升（删除不可逆）。 */}
        <div className="flex shrink-0 items-center gap-1">
          {/* 查看详情：展开快照内的标签清单（恢复前可确认内容） */}
          <RowActionButton
            label={t('查看快照内标签')}
            ariaExpanded={isDetailOpen}
            onClick={() => onToggleDetail(snap.id)}
          >
            {/* 折叠箭头复用 CollapseChevron：本行图标是 16px，比列表行默认档大一号。 */}
            <CollapseChevron collapsed={!isDetailOpen} className="h-4 w-4" />
          </RowActionButton>
          <RowActionButton
            icon={Icons.openAll}
            label={t('恢复')}
            disabled={restoring}
            iconClass="h-4 w-4"
            onClick={() => void onRestore(snap.id, snap.tabCount)}
          />
          <RowActionButton
            icon={Icons.pencil}
            label={t('重命名')}
            iconClass="h-4 w-4"
            onClick={() => onBeginRename(snap.id, snap.name)}
          />
          {/* 删除与「查看详情」「重命名」静默态完全同色同形，无 hover 设备上
             不可分；改为静默中性、hover/focus 转红（与 .row-action.is-danger
             同口径），并扩到 28px 命中区。
             危险态走 .row-action.is-danger 统一入口：手写 hover:bg-red-50 /
             hover:text-red-600 是同一语义的第二份实现，改一处漏一处；静默态若加
             text-gray-400 会压到 2.68:1（低于非文本的 3:1）。 */}
          <RowActionButton
            icon={Icons.trash}
            label={t('删除')}
            danger
            iconClass="h-4 w-4"
            onClick={() => void onDelete(snap.id)}
          />
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
                  const entryKey = diffEntryKey(tab);
                  const isExisting = diffIndex ? diffIndex.existing.has(entryKey) : false;
                  const isSkipped = diffIndex
                    ? !diffIndex.willCreate.has(entryKey) && !isExisting
                    : false;
                  const checked = selectedKeys ? selectedKeys.has(key) : undefined;
                  return (
                    <li key={key} className="flex min-w-0 items-center gap-1.5 py-1">
                      {onToggleSelected && checked !== undefined && (
                        <Checkbox
                          checked={checked}
                          ariaLabel={tab.title || tab.url}
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
                        <Chip cjk className="shrink-0 py-px">
                          {t('已存在')}
                        </Chip>
                      )}
                      {diff && isSkipped && (
                        <Chip cjk className="shrink-0 py-px">
                          {t('不恢复')}
                        </Chip>
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
                  {/* 强调色文字按钮统一走 accent-ghost 变体（与「从 OneTab 导入」同款）：
                      命中下限与 disabled:hover 兜底由变体承担，此处只补 w-full。 */}
                  <Button
                    variant="accent-ghost"
                    size="xs"
                    className="w-full"
                    disabled={restoring || selectedKeys.size === 0}
                    onClick={() => void onRestoreSelected(snap.id, selectedKeys.size)}
                  >
                    {t('恢复勾选（{{count}}）', { count: selectedKeys.size })}
                  </Button>
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
