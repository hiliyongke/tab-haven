import { memo, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from '@/i18n';
import { useDndContext } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import type { FixedFolder, FixedFolderItem } from '@/core/schema/models';
import { canSafelyDiscardTab, type TabRecord } from '@/core/tab-types';

/** 固定条目行的运行时状态（由 FolderRow 一次性建索引下传，避免每行各自扫全量标签）。 */
export interface FolderItemRuntime {
  isOpen: boolean;
  runtimeTab?: TabRecord;
}
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { Icon, Icons } from '@/ui/common/Icon';
import { RowActions } from '@/ui/common/RowActions';
import { ContextMenu, useRowContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import { RowItem } from '@/ui/common/RowItem';
import { StatusBadges } from '@/ui/common/StatusBadges';
import { classifyDrop } from '@/ui/dnd/dropPolicy';
import { DragType, type DragData } from '@/ui/dnd/types';

/** 固定条目行：复用分组标签行（row-item）的视觉与交互，排序用全局 dnd-kit。
 *  运行时状态（isOpen / runtimeTab）由 FolderRow 建索引后下传；本组件纯 memo 叶子，
 *  不再订阅 tabs，避免每个条目各自扫全量标签（O(条目×标签) 退化为 O(标签+条目)）。 */
export const FolderItemRow = memo(function FolderItemRow({
  folder,
  item,
  runtime,
  importing
}: {
  folder: FixedFolder;
  item: FixedFolderItem;
  runtime: FolderItemRuntime;
  /** 导入事务进行中：本行的写操作（移出文件夹）会被丢弃，禁用入口。 */
  importing: boolean;
}) {
  const { t } = useTranslation();
  const openSavedItem = useDataStore((state) => state.openSavedItem);
  const removeFolderItem = useDataStore((state) => state.removeFolderItem);
  const toggleMute = useTabStore((state) => state.toggleMute);
  const discardTab = useTabStore((state) => state.discardTab);

  const runtimeTab = runtime.runtimeTab;
  const isOpen = runtime.isOpen;
  const isActive = runtimeTab?.active ?? false;

  // 固定条目始终可排序（无论是否打开），不再用 isOpen 禁用。
  const sortable = useSortable({
    id: item.id,
    // 同 TabRow：关掉让位过渡，避免动画期间矩形漂移导致落点不准。
    transition: null,
    data: {
      type: DragType.FolderItem,
      folderId: folder.id,
      itemId: item.id,
      title: item.title || '',
      // 同 TabRow：带页面地址供拖拽跟随层取浏览器 favicon。
      url: item.url
    }
  });
  // 落点反馈与松手执行同源（ui/dnd/dropPolicy）：只有标签 / 分组 / 其他条目
  // 才算可放入。磁贴、文件夹拖到条目上时显示禁用态而不是假高亮。
  const { active } = useDndContext();
  const activeData = active?.data.current as DragData | undefined;
  const dropOutcome =
    sortable.isOver && activeData
      ? classifyDrop(activeData, {
          id: item.id,
          data: {
            type: DragType.FolderItem,
            folderId: folder.id,
            itemId: item.id,
            title: item.title || '',
            url: item.url
          }
        })
      : undefined;
  const dropAccepted = dropOutcome?.kind === 'accept';
  const dropRejected = dropOutcome?.kind === 'reject';

  // 同 TabRow：键盘监听挂主按钮，指针监听挂整行（避免同一事件双重激活）。
  // 全部 memo 化：解构/新建对象直接下传会击穿 RowItem 的 memo（与 TabRow 同一教训，
  // 见 TabRow.tsx「行内派生元素一律 memo 化」）。
  const sortableKeyDown = sortable.listeners?.onKeyDown as
    ((event: ReactKeyboardEvent<HTMLButtonElement>) => void) | undefined;
  const sortablePointerListeners = useMemo(() => {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sortable.listeners ?? {})) {
      if (key !== 'onKeyDown') rest[key] = value;
    }
    return rest;
  }, [sortable.listeners]);
  const buttonListeners = useMemo(
    () => (sortableKeyDown ? { onKeyDown: sortableKeyDown } : undefined),
    [sortableKeyDown]
  );

  const handleOpen = useCallback(() => void openSavedItem(item), [openSavedItem, item]);

  /**
   * 移出文件夹：删除长期保存的资产 + 顺手关掉对应标签。
   *
   * 两个副作用必须一起做成可撤销：⌘Z 只把标签重新打开、条目不会回来，用户会
   * 以为撤销没生效。故先关标签（入撤销栈），再删条目，最后用一条 toast 同时
   * 回滚两者。抽成函数供行内按钮与右键菜单共用。
   */
  const handleRemove = useCallback(() => {
    const allTabs = useTabStore.getState().tabs;
    const targetTab =
      item.pendingTabId !== undefined
        ? allTabs.find((tab) => tab.id === item.pendingTabId)
        : allTabs.find((tab) => itemUrlMatchesTab(item.url, tab));
    // 被固定的标签 closeWithUndo 不会关（见 undoStore 的 closing 过滤），也就不产生
    // 批次 —— 只有真会关掉的标签才谈得上「本次批次」。
    const closable = targetTab && !targetTab.pinned ? targetTab : undefined;
    const foldersSnapshot = useDataStore.getState().folders;
    void (
      closable ? useUndoStore.getState().closeWithUndo(allTabs, [closable.id]) : Promise.resolve()
    )
      .then(() => removeFolderItem(folder.id, item.id))
      .then(() => {
        // 撤销栈是**旧的在前**（pushBatch 追加到末尾，popBatch / undo 取 at(-1)），
        // 取 batches[0] 会拿到最早那批、撤销时把无关的旧标签重新打开。
        const closedBatchId = closable ? useUndoStore.getState().batches.at(-1)?.id : undefined;
        useUndoStore.getState().notify(t('已移出文件夹'), {
          label: t('撤销'),
          run: () => {
            void useDataStore.getState().restoreFolders(foldersSnapshot);
            if (closedBatchId) void useUndoStore.getState().undoBatch(closedBatchId);
          }
        });
      })
      .catch((error: unknown) => {
        useUndoStore.getState().notifyFailure('fixed', t('操作失败，请稍后重试'), error);
      });
  }, [folder.id, item.id, item.pendingTabId, item.url, removeFolderItem, t]);

  /* 右键菜单：条目的移出不能只有行尾一个 24px 的 ×（且会一并关标签），
     窄面板下易误触。右键给出带文字的明确操作。 */
  const { menu, open: openMenu, close: closeMenu } = useRowContextMenu();
  const menuItems = useMemo<ContextMenuItem[]>(
    () => [
      { id: 'open', label: t('打开'), onSelect: handleOpen },
      {
        id: 'remove',
        label: t('移出文件夹（已打开会一并关闭）'),
        danger: true,
        disabled: importing,
        onSelect: handleRemove
      }
    ],
    [handleOpen, handleRemove, importing, t]
  );

  const titleNode = useMemo(
    () => <span className={isOpen ? undefined : 'text-gray-500'}>{item.title || t('无标题')}</span>,
    [isOpen, item.title, t]
  );

  const badges = useMemo(
    () =>
      runtimeTab ? (
        <StatusBadges tab={runtimeTab} duplicateCount={1} isSplitCompanion={false} />
      ) : null,
    [runtimeTab]
  );

  const actions = useMemo(
    () => (
      <RowActions>
        {runtimeTab && (runtimeTab.audible || runtimeTab.muted) && (
          <button
            type="button"
            className="row-action"
            title={runtimeTab.muted ? t('取消静音') : t('静音')}
            aria-label={runtimeTab.muted ? t('取消静音') : t('静音')}
            onClick={() => void toggleMute(runtimeTab)}
          >
            <Icon d={runtimeTab.muted ? Icons.volumeOff : Icons.volumeOn} className="h-3.5 w-3.5" />
          </button>
        )}
        {runtimeTab &&
          !runtimeTab.discarded &&
          !runtimeTab.active &&
          canSafelyDiscardTab(runtimeTab) && (
            <button
              type="button"
              className="row-action"
              title={t('休眠标签（释放内存）')}
              aria-label={t('休眠标签（释放内存）')}
              onClick={() => void discardTab(runtimeTab.id)}
            >
              <Icon d={Icons.snowflake} className="h-3.5 w-3.5" />
            </button>
          )}
        <button
          type="button"
          className="row-action is-danger"
          title={t('移出文件夹（已打开会一并关闭）')}
          aria-label={t('移出文件夹（已打开会一并关闭）')}
          disabled={importing}
          onClick={handleRemove}
        >
          <Icon d={Icons.close} className="h-3.5 w-3.5" />
        </button>
      </RowActions>
    ),
    [runtimeTab, t, importing, toggleMute, discardTab, handleRemove]
  );

  // container 依赖 useSortable 的返回值：其内部对象每次渲染都是新引用，
  // 因此只取标量字段做依赖（同 TabRow 的做法）。
  const transformX = sortable.transform?.x;
  const transformY = sortable.transform?.y;
  const {
    transition: sortTransition,
    isDragging,
    setNodeRef,
    setActivatorNodeRef,
    attributes
  } = sortable;
  const container = useMemo(
    () => ({
      ref: setNodeRef,
      listeners: sortablePointerListeners,
      activatorRef: setActivatorNodeRef,
      buttonAttributes: attributes,
      buttonListeners,
      style: {
        transform:
          transformX || transformY
            ? `translate3d(${transformX ?? 0}px, ${transformY ?? 0}px, 0)`
            : undefined,
        transition: sortTransition
      },
      className: isDragging ? 'is-sorting' : undefined
    }),
    [
      setNodeRef,
      sortablePointerListeners,
      setActivatorNodeRef,
      attributes,
      buttonListeners,
      transformX,
      transformY,
      sortTransition,
      isDragging
    ]
  );

  return (
    // 独立属性名：data-tabs-tab-id 保留给真实标签行（TabRow）。固定条目
    // 与标签行共用该属性时，⌘J 定位的 querySelector 取「第一个命中」，固定区
    // DOM 在列表之前 → 同 URL 未绑定时定位永远落在条目上而非列表行。
    // 定位工具按「真实行优先、条目兜底」两段查找（见 useLocateActive）。
    <li data-folder-tab-id={runtimeTab?.id} onContextMenu={openMenu}>
      <RowItem
        faviconPageUrl={item.url}
        faviconTitle={item.title}
        faviconFallback={
          item.pendingTabId !== undefined ? (
            <span className="relative inline-flex shrink-0 items-center justify-center">
              <span className="fixed-item-pending" aria-hidden="true" />
            </span>
          ) : null
        }
        isActive={isActive}
        isMediaPlaying={runtimeTab ? runtimeTab.audible && !runtimeTab.muted : false}
        isDropTarget={dropAccepted}
        isDropRejected={dropRejected}
        onClick={handleOpen}
        buttonTitle={item.title || item.url}
        title={titleNode}
        badges={badges}
        actions={actions}
        dragGripTitle={t('拖拽调整顺序')}
        container={container}
      />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </li>
  );
});
