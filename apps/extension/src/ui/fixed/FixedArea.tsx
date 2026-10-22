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
import { Icon, Icons } from '@/ui/common/Icon';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { classifyDrop } from '@/ui/dnd/dropPolicy';
import { FIXED_AREA_DROPPABLE, type DragData } from '@/ui/dnd/types';
import { CREATE_FOLDER_REQUEST_EVENT } from '@/ui/fixed/events';
import { FolderRow } from './FolderRow';

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
  const settings = useDataStore((state) => state.settings);
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

  // 滚动边界提示：抽出为 useScrollFade，供其余内滚区复用。
  // 内容层不再有「折叠时整体替换」，文件夹增删由 hook 内的 MutationObserver 覆盖，
  // 不需要额外的重挂信号。
  useScrollFade(scrollRef);

  const handleConfirmDrop = (name: string) => {
    const request = dropRequest;
    setDropRequest(null);
    if (!request) return;
    const targetTabs = useTabStore.getState().tabs.filter((tab) => request.tabIds.includes(tab.id));
    void (async () => {
      const folder = await createFolder(name);
      // 超限时 createFolder 返回 null：不能拿一个从未落盘的 id 继续加条目，
      // 否则条目写进了一个不存在的文件夹（界面上表现为「拖过去没反应」且无提示）。
      if (!folder) return;
      await addTabsToFolder(targetTabs, folder.id);
      // 新建的文件夹可能落在固定空间的滚动区之外（固定区上限 34vh），
      // 不给反馈的话用户会以为「拖过去没反应」。
      notify(t('已新建文件夹'));
    })().catch((error: unknown) =>
      useUndoStore.getState().notifyFailure('fixed', t('操作失败，请稍后重试'), error)
    );
  };

  return (
    <>
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
          dropRejected={dropOutcome?.kind === 'reject'}
          /* 标题不带强调色条：收藏夹与「站点分组」同为一级模块头，两者必须同构
             （模块头 = 纯标题 + 计数 + 操作；强调色只属于模块内的分区卡片，
             文件夹卡片自己带品牌色条，见 FolderRow）。 */
          action={
            <div className="flex items-center gap-0.5">
              {/* 概念卡常驻入口：它原本只在「一个文件夹都没有」时出现，而用户
                  建了第一个文件夹（真正需要区分 5 种「固定」语义时）它就永久
                  消失了 —— 需要区分的那一刻恰好没有帮助。 */}
              <button
                type="button"
                className="row-action"
                title={t('什么是收藏夹 / 常驻磁贴 / 浏览器固定标签')}
                aria-label={t('查看概念说明')}
                aria-expanded={showConcepts}
                onClick={() => setShowConcepts((prev) => !prev)}
              >
                <Icon d={Icons.infoAlert} className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="row-action"
                title={t('新建文件夹')}
                aria-label={t('新建文件夹')}
                onClick={() => setCreating(true)}
              >
                <Icon d={Icons.plus} className="h-3.5 w-3.5" />
                <span className="sr-only">{t('新建文件夹')}</span>
              </button>
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
              {!settings.conceptsSeen && (
                <div className="relative mt-1">
                  <FixedConceptsMap />
                  <button
                    type="button"
                    className="chip chip--cjk absolute right-1 top-0.5 shrink-0 rounded px-1.5 py-1 text-gray-500 transition-base hover:bg-gray-100 hover:text-gray-600"
                    onClick={() => void tryUpdateSettings({ conceptsSeen: true })}
                    title={t('不再显示')}
                  >
                    {t('不再显示')}
                  </button>
                </div>
              )}
            </>
          )}
          {folders.map((folder) => (
            <FolderRow key={folder.id} folder={folder} />
          ))}
        </CategoryModule>
      </SortableContext>
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
                // null = 已达上限且已给出可操作的提示（删掉不再需要的文件夹），
                // 不能再补一句「已新建文件夹」谎报成功。
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
