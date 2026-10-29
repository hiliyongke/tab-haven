import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { FixedFolder } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { saveFolderToBookmarks } from '@/platform/bookmarks';
import { createTabsWithUrls } from '@/platform/tabs';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { itemUrlMatchesTab } from '@/core/fixed/ItemMatch';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { ContextMenu, useRowContextMenu, type ContextMenuItem } from '@/ui/common/ContextMenu';
import { GroupCard } from '@/ui/common/GroupCard';
import { CollapseChevron } from '@/ui/common/CollapseChevron';
import { DragType } from '@/ui/dnd/types';
import { LOCATE_TAB_EVENT } from '@/ui/fixed/events';
import { FolderItemRow } from '@/ui/fixed/FolderItemRow';
import { FolderRowActions } from '@/ui/fixed/FolderRowActions';
import { FolderRowDialogs, type FolderDialog } from '@/ui/fixed/FolderRowDialogs';
import { CLOSED_RUNTIME, getTabRuntimeIndex } from '@/ui/fixed/tabRuntimeIndex';

/** 固定文件夹：复用分组卡片（section-card + SectionHead）的视觉与交互。
 *
 * 本文件只保留**行的编排**：索引在 `tabRuntimeIndex`、头部操作组在
 * `FolderRowActions`、三个弹窗在 `FolderRowDialogs` —— 原 402 行里三者与
 * 拖拽/定位/菜单逻辑混排，改一个按钮的禁用条件要跨三段 JSX 定位。
 */
export const FolderRow = memo(function FolderRow({ folder }: { folder: FixedFolder }) {
  const { t } = useTranslation();
  const renameFolder = useDataStore((state) => state.renameFolder);
  const deleteFolder = useDataStore((state) => state.deleteFolder);
  const toggleFolderCollapsed = useDataStore((state) => state.toggleFolderCollapsed);
  const onRestoreFolderAsGroup = useDataStore((state) => state.syncFolderToNativeGroup);
  /** 导入事务进行中：期间写固定空间会被丢弃，相关入口禁用（见 DataState.importing）。 */
  const importing = useDataStore((state) => state.importing);
  const notify = useUndoStore((state) => state.notify);

  /**
   * 删除文件夹 + 一次性撤销。
   * 删除必须有回退点：确认弹窗只降低误触概率，误确认后整份长期资产就没了。
   * 这里在写盘前留一份 folders 快照，成功后 toast 上给「撤销」。
   * 仍然绝不能先报成功：写盘失败走 notifyFailure（Promise 被拒即有 error，
   * 提示与留痕必须同时成立）。
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
      (error: unknown) =>
        useUndoStore.getState().notifyFailure('fixed', t('操作失败，请稍后重试'), error)
    );
  }, [deleteFolder, folder.id, notify, t]);
  const tabs = useTabStore((state) => state.tabs);

  /**
   * 每个条目的运行时状态（是否打开 / 命中的实时标签）。
   *
   * 一次性 O(标签) 遍历建索引，供所有 FolderItemRow 复用，避免每行各自
   * `tabs.some` + `tabs.find` 的 O(条目×标签) 扫描。
   * 匹配口径与 `itemUrlMatchesTab` 同源（比较键优先，非 http(s) 回退原样比较），
   * 但这里是**索引化**实现（预建 byKey / byRawUrl / byId 三张表后 O(1) 查表），
   * 不是逐条目调用该函数 —— 差异仅在于 URL 索引排除隐身标签
   * （与 handleOpenAll / openSavedItem 的 `!tab.incognito` 同口径）。
   * 索引随 tabs / folder.items 变化重算；FolderItemRow 接收索引结果并以 memo 叶子组件渲染。
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
  const [dialog, setDialog] = useState<FolderDialog>(null);
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

  // 头部操作与右键菜单共用同一组 handler。
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
      .catch((error: unknown) =>
        useUndoStore.getState().notifyFailure('fixed', t('操作失败，请稍后重试'), error)
      );
  }, [folder.items, notify, t, tabs]);
  const handleExportBookmarks = useCallback(() => {
    void saveFolderToBookmarks(folder)
      .then((count) =>
        notify(count > 0 ? t('已导出 {{count}} 条到书签', { count }) : t('文件夹为空，未导出书签'))
      )
      .catch((error: unknown) =>
        useUndoStore.getState().notifyFailure('fixed', t('操作失败，请稍后重试'), error)
      );
  }, [folder, notify, t]);

  /** 转原生组：执行期间置 `converting`，禁用入口避免同一文件夹重复转换。 */
  const handleConvert = useCallback(() => {
    setConverting(true);
    void onRestoreFolderAsGroup(folder.id)
      .then((converted) => notify(t(converted ? '已恢复为原生标签组' : '文件夹中没有可转换的标签')))
      // 失败必须走 error 强度（role="alert"）：用 notify（role="status"）会
      // 把它降级成普通状态排队播报，与同文件其它失败路径的语义强度不一致。
      .catch((error: unknown) =>
        useUndoStore.getState().notifyFailure('fixed', t('恢复原生标签组失败'), error)
      )
      .finally(() => setConverting(false));
  }, [folder.id, notify, onRestoreFolderAsGroup, t]);

  const handleRename = useCallback(
    (name: string) => {
      void renameFolder(folder.id, name).then(
        () => notify(t('已重命名文件夹')),
        (error: unknown) =>
          useUndoStore.getState().notifyFailure('fixed', t('操作失败，请稍后重试'), error)
      );
    },
    [folder.id, notify, renameFolder, t]
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
          icon={<CollapseChevron collapsed={folder.collapsed} />}
          onToggle={() => void toggleFolderCollapsed(folder.id)}
          action={
            <FolderRowActions
              importing={importing}
              converting={converting}
              onOpenAll={handleOpenAll}
              onExportBookmarks={handleExportBookmarks}
              onConvert={() => setDialog({ type: 'convert' })}
              onEdit={() => setDialog({ type: 'edit' })}
              onDelete={() => setDialog({ type: 'delete' })}
            />
          }
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
      <FolderRowDialogs
        dialog={dialog}
        folder={folder}
        onClose={() => setDialog(null)}
        onRename={handleRename}
        onDelete={deleteWithUndo}
        onConvert={handleConvert}
      />
    </>
  );
});
