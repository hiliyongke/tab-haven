import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { PromptDialog } from '@/ui/dialog/Dialog';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { FixedConceptsMap } from '@/ui/common/FixedConceptsMap';
import { Chip } from '@/ui/common/Chip';
import { Icons } from '@/ui/common/Icon';
import { RowActionButton } from '@/ui/common/RowActionButton';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { useRowRoving } from '@/ui/hooks/useRowRoving';
import { classifyDrop } from '@/ui/dnd/dropPolicy';
import { FIXED_AREA_DROPPABLE, type DragData } from '@/ui/dnd/types';
import { CREATE_FOLDER_REQUEST_EVENT } from '@/ui/fixed/events';
import { FolderRow } from '@/ui/fixed/FolderRow';

interface CreateFolderRequest {
  name: string;
  tabIds: number[];
}

/** 投放区数据：模块级常量，避免每次渲染新建对象让 dnd-kit 重算 droppable。 */
const FIXED_AREA_DROP_DATA = { type: FIXED_AREA_DROPPABLE } as const;

/** 固定空间区域：header（说明/新建）+ 文件夹列表（复用分组卡片视觉），
 *  整体是 useDroppable 目标（拖标签/分组到空白处创建新文件夹）。
 *
 *  刻意**不提供折叠**：收藏夹是侧边栏的一级标题，与「站点分组 / 未分组」同级；
 *  一级标题一旦可收起，下方列表就失去归属锚点。固定区本身已有 34vh 内滚上限，
 *  文件夹再多也不会把标签列表挤出首屏——当初的折叠动机已被这条上限覆盖。 */
export function FixedArea() {
  const { t } = useTranslation();
  const folders = useDataStore((state) => state.folders);
  const createFolder = useDataStore((state) => state.createFolder);
  const addTabsToFolder = useDataStore((state) => state.addTabsToFolder);
  const tryUpdateSettings = useDataStore((state) => state.tryUpdateSettings);
  // 只订阅用到的字段：订阅整个 settings 对象会让任意设置变更都重渲染固定区
  // （而本组件只用 conceptsSeen 决定是否展示首启概念卡）。
  const conceptsSeen = useDataStore((state) => state.settings.conceptsSeen);
  const notify = useUndoStore((state) => state.notify);
  const [creating, setCreating] = useState(false);
  const [dropRequest, setDropRequest] = useState<CreateFolderRequest | null>(null);
  /** 概念说明的手动开关（与首启自动展示的 conceptsSeen 相互独立）。 */
  const [showConcepts, setShowConcepts] = useState(false);
  // 不订阅 tabs：它仅用于建文件夹弹窗确认时的一次性过滤，订阅会让每次标签快照
  // 都重渲染整个固定区。事件期经 getState 读最新值即可（与其它 handler 同一约定）。
  const folderSortableIds = useMemo(
    () => folders.map((folder) => `folder:${folder.id}`),
    [folders]
  );
  /** 固定区条目的键盘漫游：FolderItemRow 的行已带 data-row-activate（漫游就绪），
   *  但本区在 App 的主列表漫游容器之外，方向键覆盖不到。单独接一路 useRowRoving，
   *  让收藏夹条目多时也能 ↑↓/Home/End 穿行，而非逐行逐按钮 Tab。 */
  const fixedRovingRef = useRef<HTMLDivElement>(null);
  const handleFixedAreaKeyDown = useRowRoving(fixedRovingRef);
  const { isOver, setNodeRef } = useDroppable({
    id: FIXED_AREA_DROPPABLE,
    data: FIXED_AREA_DROP_DATA
  });
  // 落点接受与否与松手执行同源（ui/dnd/dropPolicy）：
  // 拖文件夹 / 磁贴 / 收藏夹条目到这里时显示禁用态，而不是亮一下再无声失败。
  const { active } = useDndContext();
  const activeData = active?.data.current as DragData | undefined;
  const dropOutcome = activeData
    ? classifyDrop(activeData, { id: FIXED_AREA_DROPPABLE, data: FIXED_AREA_DROP_DATA })
    : undefined;
  // 滚动边界提示要监听容器节点，而 CategoryModule 只透传 dnd 的 setNodeRef
  // （不提供独立 ref）：这里把它包一层，顺带把节点留在本地 ref 里，
  // 免去全局 querySelector（那会取到页面上任意一处 .fixed-area）。
  const scrollRef = useRef<HTMLElement | null>(null);
  const attachNodeRef = useCallback(
    (node: HTMLElement | null) => {
      scrollRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef]
  );

  useEffect(() => {
    const handleCreateRequest = (event: Event) => {
      const detail = (event as CustomEvent<CreateFolderRequest>).detail;
      if (!detail || !detail.name || !Array.isArray(detail.tabIds) || detail.tabIds.length === 0)
        return;
      setDropRequest(detail);
    };
    window.addEventListener(CREATE_FOLDER_REQUEST_EVENT, handleCreateRequest);
    return () => window.removeEventListener(CREATE_FOLDER_REQUEST_EVENT, handleCreateRequest);
  }, []);

  // 滚动边界提示由 useScrollFade 统一管理；文件夹增删通过 hook 内的 MutationObserver 更新。
  useScrollFade(scrollRef);

  const handleConfirmDrop = (name: string) => {
    const request = dropRequest;
    setDropRequest(null);
    if (!request) return;
    const targetTabs = useTabStore.getState().tabs.filter((tab) => request.tabIds.includes(tab.id));
    void (async () => {
      const folder = await createFolder(name);
      // 超限时 createFolder 返回 null；没有已落盘的 folder id 时中止添加条目。
      if (!folder) return;
      await addTabsToFolder(targetTabs, folder.id);
      // 新建文件夹可能位于固定空间的滚动区之外，因此完成后显示操作回执。
      notify(t('已新建文件夹'));
    })().catch((error: unknown) =>
      useUndoStore.getState().notifyFailure('fixed', t('操作失败，请稍后重试'), error)
    );
  };

  return (
    <>
      {/* 漫游边界：包住整个固定区，findActivatableRows 在其内查所有带
          data-row-activate 的行按钮。div 不改变 .fixed-area 内部滚动/边框语义，
          仅承接 ↑↓/Home/End 的键盘漫游事件（冒泡自内部行按钮）。 */}
      <div ref={fixedRovingRef} onKeyDown={handleFixedAreaKeyDown}>
        <SortableContext items={folderSortableIds} strategy={verticalListSortingStrategy}>
          <CategoryModule
            title={t('收藏夹')}
            count={folders.length}
            /* 这里计的是文件夹数，不是标签数（读屏口径必须跟着变）。 */
            countLabel={t('共 {{count}} 个文件夹', { count: folders.length })}
            aria-label={t('收藏夹')}
            className="module-shell fixed-area scroll-fade"
            setNodeRef={attachNodeRef}
            isOver={isOver}
            outcome={dropOutcome}
            /* 标题不带强调色条：收藏夹与「站点分组」同为一级模块头，两者必须同构
             （模块头 = 纯标题 + 计数 + 操作；强调色只属于模块内的分区卡片，
             文件夹卡片自己带品牌色条，见 FolderRow）。 */
            action={
              <div className="flex items-center gap-0.5">
                {/* 概念卡常驻入口：需要区分 5 种「固定」语义的那一刻，恰是最初空态提示已消失之后。 */}
                {/* tooltip 比可访问名长：悬停要能看懂「这是什么」，读屏只需「查看概念说明」。 */}
                <RowActionButton
                  icon={Icons.infoAlert}
                  label={t('查看概念说明')}
                  tooltip={t('什么是收藏夹 / 常驻磁贴 / 浏览器固定标签')}
                  ariaExpanded={showConcepts}
                  onClick={() => setShowConcepts((prev) => !prev)}
                />
                <RowActionButton
                  icon={Icons.plus}
                  label={t('新建文件夹')}
                  onClick={() => setCreating(true)}
                />
              </div>
            }
          >
            {showConcepts && folders.length > 0 && (
              <div className="mt-1">
                <FixedConceptsMap />
              </div>
            )}
            {folders.length === 0 && (
              <>
                <p className="fixed-area-empty">
                  {t('点击 + 新建文件夹，或直接把标签/分组拖到这里')}
                </p>
                {!conceptsSeen && (
                  <div className="relative mt-1">
                    <FixedConceptsMap />
                    <Chip
                      cjk
                      className="absolute right-1 top-0.5 py-1 hover:bg-gray-100 hover:text-gray-600"
                      title={t('不再显示')}
                      onClick={() => void tryUpdateSettings({ conceptsSeen: true })}
                    >
                      {t('不再显示')}
                    </Chip>
                  </div>
                )}
              </>
            )}
            {folders.map((folder) => (
              <FolderRow key={folder.id} folder={folder} />
            ))}
          </CategoryModule>
        </SortableContext>
      </div>
      {/* 弹窗放在模块内容层之外：它是页面级模态（Portal 挂到 body），不属于列表内容，
          也不该跟着列表结构参与拖拽 / 行级键盘语义。 */}
      {creating && (
        <PromptDialog
          title={t('新建文件夹')}
          /* 空输入框 + 聚焦态边框在无 placeholder 时会被误读为「出错了」：
             补上示例文案，同时让「确定」为何禁用（空值）一目了然。 */
          placeholder={t('文件夹名称')}
          onConfirm={(name) => {
            setCreating(false);
            void createFolder(name).then(
              (folder) =>
                // null 表示已达上限且已给出可操作提示；仅创建成功时显示完成回执。
                folder ? notify(t('已新建文件夹')) : undefined,
              (error: unknown) =>
                useUndoStore.getState().notifyFailure('fixed', t('操作失败，请稍后重试'), error)
            );
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {dropRequest && (
        <PromptDialog
          title={t('新建文件夹')}
          initialValue={dropRequest.name}
          placeholder={t('文件夹名称')}
          onConfirm={handleConfirmDrop}
          onCancel={() => setDropRequest(null)}
        />
      )}
    </>
  );
}
