import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { FixedFolder } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { saveFolderToBookmarks } from '@/platform/bookmarks';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { createTabsWithUrls } from '@/platform/tabs';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { ContextMenu, useRowContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';
import { FolderEditDialog } from '@/ui/fixed/FolderEditDialog';
import { GroupCard } from '@/ui/common/GroupCard';
import { Icon, Icons } from '@/ui/common/Icon';
import { DragType } from '@/ui/dnd/types';
import { LOCATE_TAB_EVENT } from '@/ui/fixed/events';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import { FolderItemRow } from './FolderItemRow';

/**
 * 全量标签 → 条目匹配索引（按 tabs 数组引用做模块级缓存）。
 *
 * N 个 FolderRow 各自建索引是 N×O(标签) 的重复劳动；索引内容只取决于 tabs
 * 引用，缓存后每次快照全局只建一次（与 PinnedStrip 的 buildPinRuntimeIndex 同思路）。
 */
interface TabRuntimeIndex {
  byKey: Map<string, TabRecord>;
  byRawUrl: Map<string, TabRecord>;
  byId: Map<number, TabRecord>;
}
let indexCacheTabs: readonly TabRecord[] | null = null;
let indexCache: TabRuntimeIndex | null = null;
function getTabRuntimeIndex(tabs: readonly TabRecord[]): TabRuntimeIndex {
  if (indexCache && tabs === indexCacheTabs) return indexCache;
  const byKey = new Map<string, TabRecord>();
  const byRawUrl = new Map<string, TabRecord>();
  const byId = new Map<number, TabRecord>();
  for (const tab of tabs) {
    // URL 索引排除隐身标签：与 handleOpenAll / openSavedItem 的匹配口径一致
    // （均含 !tab.incognito）。否则隐身窗口里打开的条目会显示「已打开」，
    // 而「打开全部」仍判其缺失再次打开。byId 保留全量（pendingTabId 是显式绑定）。
    if (tab.url && !tab.incognito) {
      const key = webComparisonKey(tab.url, tab.pendingUrl);
      if (key !== null) byKey.set(key, tab);
      byRawUrl.set(tab.url, tab);
    }
    byId.set(tab.id, tab);
  }
  indexCacheTabs = tabs;
  indexCache = { byKey, byRawUrl, byId };
  return indexCache;
}

/** 未打开条目的运行时状态单例：内联 `{ isOpen: false }` 每次渲染都是新引用，会击穿 FolderItemRow 的 memo。 */
const CLOSED_RUNTIME = { isOpen: false } as const;

/** 固定文件夹：复用分组卡片（section-card + SectionHead）的视觉与交互。 */
export const FolderRow = memo(function FolderRow({ folder }: { folder: FixedFolder }) {
  const { t } = useTranslation();
  const renameFolder = useDataStore((state) => state.renameFolder);
  const deleteFolder = useDataStore((state) => state.deleteFolder);
  const toggleFolderCollapsed = useDataStore((state) => state.toggleFolderCollapsed);
  const onRestoreFolderAsGroup = useDataStore((state) => state.syncFolderToNativeGroup);
  /** 导入事务进行中：期间写固定空间会被丢弃，相关入口禁用（见 DataState.importing）。 */
  const importing = useDataStore((state) => state.importing);
  const notify = useUndoStore((state) => state.notify);
  const notifyError = useUndoStore((state) => state.notifyError);

  /**
   * 删除文件夹 + 一次性撤销。
   * 删除必须有回退点：确认弹窗只降低误触概率，误确认后整份长期资产就没了。
   * 这里在写盘前留一份 folders 快照，成功后 toast 上给「撤销」。
   * 仍然绝不能先报成功：写盘失败走 notifyError。
   */
  const deleteWithUndo = useCallback(() => {
    const before = useDataStore.getState().folders;
    void deleteFolder(folder.id).then(
      () =>
        notify(t('已删除文件夹'), {
          label: t('撤销'),
          run: () => {
            void useDataStore.getState().restoreFolders(before);
          }
        }),
      () => notifyError(t('操作失败，请稍后重试'))
    );
  }, [deleteFolder, folder.id, notify, notifyError, t]);
  const tabs = useTabStore((state) => state.tabs);

  /**
   * 每个条目的运行时状态（是否打开 / 命中的实时标签）。
   *
   * 一次性 O(标签) 遍历建索引，供所有 FolderItemRow 复用，避免每行各自
   * `tabs.some` + `tabs.find` 的 O(条目×标签) 扫描。
   * 匹配口径统一走 `itemUrlMatchesTab`（与 openSavedItem / 行内关闭同源）。
   * 索引随 tabs / folder.items 变化重算；FolderItemRow 改为纯 memo 叶子，仅自身运行时变化时才重渲染。
   */
  const runtimeByItem = useMemo(() => {
    // 索引全局共享（按 tabs 引用缓存），本层只做 O(条目) 的映射。
    const { byKey, byRawUrl, byId } = getTabRuntimeIndex(tabs);
    const map = new Map<string, { isOpen: boolean; runtimeTab?: TabRecord }>();
    for (const item of folder.items) {
      if (item.pendingTabId !== undefined) {
        const runtimeTab = byId.get(item.pendingTabId);
        map.set(item.id, { isOpen: true, runtimeTab });
      } else {
        const itemKey = item.url === undefined ? null : webComparisonKey(item.url, undefined);
        const runtimeTab =
          item.url === undefined
            ? undefined
            : itemKey !== null
              ? byKey.get(itemKey)
              : byRawUrl.get(item.url);
        map.set(item.id, { isOpen: runtimeTab !== undefined, runtimeTab });
      }
    }
    return map;
  }, [tabs, folder.items]);

  /** 弹窗状态：edit 改名 / convert 转原生组 / delete 删除确认。
   *  删除必须有确认 —— 文件夹是用户长期积累的资产，直删不可撤销。 */
  const [dialog, setDialog] = useState<
    { type: 'edit' } | { type: 'convert' } | { type: 'delete' } | null
  >(null);
  /** 转原生组执行中：该操作会先恢复已关闭条目（逐个开标签）再建组，耗时可能数百 ms，
   *  期间禁用转换入口，避免重复触发同一文件夹的第二次转换。 */
  const [converting, setConverting] = useState(false);

  /**
   * 定位事件依赖的最新值。
   *
   * `tabs` 每次标签快照都是新数组，若进 effect 依赖，每个文件夹都会在每次快照时
   * 解绑/重绑一次监听。用 ref 取最新值，监听只挂载一次（与 SectionList 同写法）。
   * 提交后更新而非渲染期赋值：并发渲染下渲染可能不提交，渲染期写 ref 会把
   * 未提交的中间值泄漏给事件监听（同 VirtualRowList/SectionList 的约定）。
   */
  const locateRef = useRef({ tabs, folder });
  useEffect(() => {
    locateRef.current = { tabs, folder };
  }, [tabs, folder]);

  useEffect(() => {
    const handleLocate = (event: Event) => {
      const tabId = (event as CustomEvent<number>).detail;
      if (!Number.isInteger(tabId)) return;
      const { tabs: currentTabs, folder: currentFolder } = locateRef.current;
      const belongsToFolder = currentTabs.some(
        (tab) =>
          tab.id === tabId &&
          currentFolder.items.some(
            (item) => itemUrlMatchesTab(item.url, tab) || item.pendingTabId === tab.id
          )
      );
      if (currentFolder.collapsed && belongsToFolder) void toggleFolderCollapsed(currentFolder.id);
    };
    window.addEventListener(LOCATE_TAB_EVENT, handleLocate);
    return () => window.removeEventListener(LOCATE_TAB_EVENT, handleLocate);
  }, [toggleFolderCollapsed]);

  // 文件夹排序（dnd-kit）：SortableContext 在外层 FixedArea，条目 SortableContext 在本层。
  const folderDragData = {
    type: DragType.Folder,
    folderId: folder.id,
    name: folder.name
  } as const;
  // items 数组必须 memo 化：每次渲染新建数组会让 dnd-kit context value 变化，
  // 子 sortable 节点多做一轮无效重渲染。
  const itemSortableIds = useMemo(() => folder.items.map((item) => item.id), [folder.items]);

  // 头部操作：与原生组同款布局 [打开全部 / 存为书签 / 转原生组 / 编辑]，删除整合到 FolderEditDialog。
  // useCallback：右键菜单的 items 是 useMemo，依赖这两个 handler；不 memo 化会让
  // 菜单项数组每次渲染都重建（进而让 ContextMenu 的键盘监听反复解绑重挂）。
  const handleOpenAll = useCallback(() => {
    const missing = folder.items.filter(
      (item) =>
        item.url &&
        item.pendingTabId === undefined &&
        !tabs.some((tab) => itemUrlMatchesTab(item.url, tab) && !tab.incognito)
    );
    if (missing.length === 0) {
      notify(t('文件夹条目均已打开'));
      return;
    }
    void createTabsWithUrls(missing.map((item) => item.url).filter((u): u is string => Boolean(u)))
      .then((created) => notify(t('已打开 {{count}} 个条目', { count: created })))
      .catch(() => notifyError(t('操作失败，请稍后重试')));
  }, [folder.items, notify, notifyError, t, tabs]);
  const handleExportBookmarks = useCallback(() => {
    void saveFolderToBookmarks(folder)
      .then((count) =>
        notify(count > 0 ? t('已导出 {{count}} 条到书签', { count }) : t('文件夹为空，未导出书签'))
      )
      .catch(() => notifyError(t('操作失败，请稍后重试')));
  }, [folder, notify, notifyError, t]);
  const headerAction = (
    <>
      <button
        type="button"
        className="row-action"
        title={t('打开文件夹全部条目')}
        aria-label={t('打开文件夹全部条目')}
        onClick={(event) => {
          event.stopPropagation();
          handleOpenAll();
        }}
      >
        <Icon d={Icons.openAll} className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="row-action"
        title={t('导出到浏览器书签')}
        aria-label={t('导出到浏览器书签')}
        onClick={(event) => {
          event.stopPropagation();
          handleExportBookmarks();
        }}
      >
        <Icon d={Icons.bookmarkAdd} className="h-3.5 w-3.5" />
      </button>
      {/* 转原生组 / 编辑（含删除）会写固定空间：导入事务期间写入会被丢弃，
          点了只会「没反应」，直接禁用入口。
          「打开全部」「存为书签」不改固定空间数据，不受影响。 */}
      <button
        type="button"
        className="row-action"
        title={t('恢复为原生标签组')}
        aria-label={t('恢复为原生标签组')}
        disabled={importing || converting}
        onClick={(event) => {
          event.stopPropagation();
          setDialog({ type: 'convert' });
        }}
      >
        <Icon d={Icons.toNativeGroup} className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="row-action"
        title={t('编辑文件夹')}
        aria-label={t('编辑文件夹')}
        disabled={importing}
        onClick={(event) => {
          event.stopPropagation();
          setDialog({ type: 'edit' });
        }}
      >
        <Icon d={Icons.pencil} className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="row-action is-danger"
        title={t('删除文件夹（标签保留）')}
        aria-label={t('删除文件夹（标签保留）')}
        disabled={importing}
        onClick={(event) => {
          event.stopPropagation();
          setDialog({ type: 'delete' });
        }}
      >
        <Icon d={Icons.trash} className="h-3.5 w-3.5" />
      </button>
    </>
  );

  /* 右键菜单：文件夹的 5 个操作不能只有无文字图标按钮一条路 —— 窄面板下容易误点
     相邻的删除，键盘用户也无法唤出。这里补齐与标签行一致的右键入口。 */
  const { menu: contextMenu, open: openContextMenu, close: closeContextMenu } = useRowContextMenu();
  const contextMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      { id: 'openAll', label: t('打开文件夹全部条目'), onSelect: handleOpenAll },
      { id: 'export', label: t('导出到浏览器书签'), onSelect: handleExportBookmarks },
      {
        id: 'convert',
        label: t('恢复为原生标签组'),
        disabled: importing || converting,
        onSelect: () => setDialog({ type: 'convert' })
      },
      {
        id: 'edit',
        label: t('编辑文件夹'),
        disabled: importing,
        onSelect: () => setDialog({ type: 'edit' })
      },
      {
        id: 'delete',
        label: t('删除文件夹（标签保留）'),
        danger: true,
        disabled: importing,
        onSelect: () => setDialog({ type: 'delete' })
      }
    ],
    [converting, handleExportBookmarks, handleOpenAll, importing, t]
  );

  return (
    <>
      <div onContextMenu={openContextMenu}>
        <GroupCard
          id={`folder:${folder.id}`}
          dragData={folderDragData}
          title={folder.name}
          count={folder.items.length}
          accent="var(--c-brand-500)"
          icon={
            <Icon
              d={Icons.chevron}
              className={
                'icon h-3.5 w-3.5 transition-transform' + (folder.collapsed ? '' : ' rotate-90')
              }
            />
          }
          onToggle={() => void toggleFolderCollapsed(folder.id)}
          action={headerAction}
          collapsed={folder.collapsed}
        >
          {!folder.collapsed && (
            <SortableContext items={itemSortableIds} strategy={verticalListSortingStrategy}>
              <div className="section-body">
                <ul>
                  {folder.items.map((item) => (
                    <FolderItemRow
                      key={item.id}
                      folder={folder}
                      item={item}
                      runtime={runtimeByItem.get(item.id) ?? CLOSED_RUNTIME}
                      importing={importing}
                    />
                  ))}
                </ul>
              </div>
            </SortableContext>
          )}
        </GroupCard>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
      {/* 弹窗必须脱离 GroupCard 的折叠闸门：GroupCard 对 children 用了
        {!collapsed && children}，折叠态下弹窗不会被挂载，导致点编辑/删除/转原生组无反应。
        弹窗经 Portal 挂到 body，放到这里不受 DOM 层级影响。 */}
      {dialog?.type === 'edit' && (
        <FolderEditDialog
          initialName={folder.name}
          onRename={(name) => {
            void renameFolder(folder.id, name).then(
              () => notify(t('已重命名文件夹')),
              () => notifyError(t('操作失败，请稍后重试'))
            );
          }}
          onDelete={() => deleteWithUndo()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'convert' && (
        <ConfirmDialog
          title={t('恢复为原生标签组')}
          message={t('将打开「{{name}}」中的标签，并删除这个文件夹。是否继续？', {
            name: folder.name
          })}
          danger
          onConfirm={() => {
            setDialog(null);
            setConverting(true);
            void onRestoreFolderAsGroup(folder.id)
              .then((converted) =>
                notify(t(converted ? '已恢复为原生标签组' : '文件夹中没有可转换的标签'))
              )
              .catch(() => notify(t('恢复原生标签组失败')))
              .finally(() => setConverting(false));
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title={t('删除文件夹')}
          message={t('删除文件夹“{{name}}”？正在打开的标签不会关闭。', { name: folder.name })}
          danger
          confirmLabel={t('确认删除')}
          onConfirm={() => {
            setDialog(null);
            deleteWithUndo();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
});
