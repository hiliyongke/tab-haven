import type { RefObject } from 'react';
import { useTranslation } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import type { SnapshotDiffResult } from '@/core/snapshot/snapshotDiff';
import { isImeComposing } from '@/core/util/keyboard';
import { Button } from '@/ui/common/Button';
import { EmptyState } from '@/ui/common/EmptyState';
import { Icon, Icons } from '@/ui/common/Icon';
import { LoadErrorState, LoadingSkeleton } from '@/ui/common/ListStates';
import { TextField } from '@/ui/common/TextField';
import { SnapshotRow } from '@/ui/snapshot/SnapshotRow';

/** 按生命周期划分的展示组（概念收敛：命名 / 归档 / 自动）。 */
export interface SnapshotGroup {
  key: 'named' | 'archive' | 'auto';
  title: string;
  desc: string;
  items: Snapshot[];
}

/**
 * 列表视图：保存入口 + 分组快照列表 + 底部次级入口。
 *
 * 从面板拆出的原因：这段是面板里唯一的「快照读写界面」，占原文件近 120 行，
 * 与导入表单、周报统计互不相干却挤在同一段 JSX 里。
 */
export function SnapshotListView({
  ordered,
  groups,
  saving,
  onStartSaving,
  name,
  onNameChange,
  onSave,
  onCancelSaving,
  savingSpace,
  onSaveSpace,
  editingId,
  editingName,
  onEditingNameChange,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  detailId,
  onToggleDetail,
  detailDiff,
  selectedKeys,
  onToggleSelected,
  onRestoreSelected,
  restoringId,
  onRequestRestore,
  onDelete,
  onOpenImport,
  onOpenReport,
  state,
  onRetryLoad,
  listRef
}: {
  ordered: Snapshot[];
  groups: SnapshotGroup[];
  /**
   * 数据状态：空列表与「还没读到 / 读不到」必须分开。
   * 判据只有 `length === 0` 时，首帧与读盘失败都会说「还没有快照」——
   * 后者是假信息（数据可能在，只是读不出来），且没有任何重试出口。
   */
  state: 'loading' | 'ready' | 'error';
  onRetryLoad: () => void;
  saving: boolean;
  onStartSaving: () => void;
  name: string;
  onNameChange: (value: string) => void;
  onSave: () => void;
  onCancelSaving: () => void;
  savingSpace: boolean;
  onSaveSpace: () => void;
  editingId: string | null;
  editingName: string;
  onEditingNameChange: (value: string) => void;
  onBeginRename: (id: string, current: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  detailId: string | null;
  onToggleDetail: (id: string) => void;
  /** 下列回调签名与 SnapshotRow 的行契约一致（恢复类带影响面条数，删除只带 id）。 */
  detailDiff: SnapshotDiffResult | undefined;
  selectedKeys: Set<string> | undefined;
  onToggleSelected: (key: string) => void;
  onRestoreSelected: (id: string, tabCount: number) => void;
  restoringId: string | null;
  onRequestRestore: (id: string, tabCount: number) => void;
  onDelete: (id: string) => void;
  onOpenImport: () => void;
  onOpenReport: () => void;
  /** 列表容器 ref：删除快照后作为焦点归还的稳定落点（原触发按钮随行卸载，焦点会掉 body）。 */
  listRef?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  return (
    // tabIndex=-1：删除行后由面板程序化聚焦到这个**存活**容器，避免焦点掉回 <body>。
    // -1 不进入 Tab 序列，不影响键盘漫游；focus-visible 环仅在键盘主动聚焦时出现。
    <div ref={listRef} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      {!saving ? (
        <div className="flex gap-2">
          <Button
            variant="soft-outline"
            className="flex-1 gap-2"
            tooltip={t('把当前窗口的标签存为一份快照，随时可整体恢复；不会出现在顶部切换条')}
            onClick={onStartSaving}
          >
            <Icon d={Icons.snapshot} className="h-4 w-4" />
            {t('保存当前窗口为快照')}
          </Button>
          <Button
            variant="secondary-outline"
            className="gap-2"
            tooltip={t(
              '把当前窗口存为一份「工作区」快照，可在顶部切换条一键切换；切走前会先保存当前窗口。每次保存都新增一条，不覆盖旧版'
            )}
            disabled={savingSpace}
            onClick={onSaveSpace}
          >
            <Icon d={Icons.layers} className="h-4 w-4" />
            {t('保存为工作区')}
            {/* 感叹号提醒：该按钮语义不直观（每次保存都新增一条，不覆盖），悬停看完整说明 */}
            <Icon d={Icons.infoAlert} className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-surface px-2 py-1.5">
          <Icon d={Icons.snapshot} className="h-4 w-4 shrink-0 text-gray-500" />
          <TextField
            variant="bare"
            className="min-w-0 flex-1 text-sm"
            placeholder={t('为这个快照起个名字（可留空）')}
            ariaLabel={t('为这个快照起个名字（可留空）')}
            /* 进入命名态后焦点立即落进输入框：触发的「保存当前窗口为快照」按钮
               已在本次渲染中卸载，autoFocus 避免焦点掉回 body、键盘用户无从继续输入。 */
            inputProps={{ autoFocus: true }}
            value={name}
            onChange={onNameChange}
            onKeyDown={(event) => {
              // 输入法组合中 Enter/Esc 属于选词与取消候选：直接回车会把半截拼音存成快照名。
              if (isImeComposing(event)) return;
              if (event.key === 'Enter') onSave();
              if (event.key === 'Escape') onCancelSaving();
            }}
          />
          <Button variant="primary" size="xs" onClick={onSave}>
            {t('保存')}
          </Button>
          <Button variant="ghost" size="xs" onClick={onCancelSaving}>
            {t('取消')}
          </Button>
        </div>
      )}

      {/* 滚动由 DialogShell 内容区承担，保持单一滚动容器；内容区 padding 控制列表与标题栏的右边缘对齐。 */}
      <div className="flex flex-col gap-2">
        {state === 'loading' ? (
          /* 加载态使用与主列表一致的骨架，保持状态切换时文案与版面稳定。 */
          <LoadingSkeleton />
        ) : state === 'error' ? (
          <LoadErrorState onRetry={onRetryLoad} />
        ) : ordered.length === 0 ? (
          /* 复用通用空态：与面板其余空态同款（图标 + 说明），手写会出现三处三种观感。 */
          <EmptyState
            icon={<Icon d={Icons.snapshot} className="h-4 w-4" />}
            title={t('还没有快照。误关窗口后会自动保存，也可以随时手动保存当前窗口。')}
          />
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <h3 className="group-label mb-1 flex items-baseline gap-1">
                {group.title}
                <span className="text-gray-500">
                  {t('{{count}} 份', { count: group.items.length })}
                </span>
              </h3>
              {group.desc && (
                <p className="mb-1 text-3xs leading-snug text-gray-500">{group.desc}</p>
              )}
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {group.items.map((snap) => (
                  <SnapshotRow
                    key={snap.id}
                    snap={snap}
                    isEditing={editingId === snap.id}
                    editingName={editingName}
                    isDetailOpen={detailId === snap.id}
                    onEditingNameChange={onEditingNameChange}
                    onBeginRename={onBeginRename}
                    onCommitRename={onCommitRename}
                    onCancelRename={onCancelRename}
                    onToggleDetail={onToggleDetail}
                    onRestore={onRequestRestore}
                    onDelete={onDelete}
                    restoring={restoringId === snap.id}
                    diff={detailId === snap.id ? detailDiff : undefined}
                    selectedKeys={detailId === snap.id ? selectedKeys : undefined}
                    onToggleSelected={onToggleSelected}
                    onRestoreSelected={onRestoreSelected}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2 border-t border-gray-200 pt-2">
        <Button variant="ghost" size="xs" className="flex-1" onClick={onOpenImport}>
          {t('从 OneTab 导入')}
        </Button>
        <Button variant="ghost" size="xs" className="flex-1" onClick={onOpenReport}>
          {t('本周周报')}
        </Button>
      </div>
    </div>
  );
}
