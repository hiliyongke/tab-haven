import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useDndMonitor, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { PromptDialog } from '@/ui/dialog/Dialog';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { FixedConceptsMap } from '@/ui/common/FixedConceptsMap';
import { Icon, Icons } from '@/ui/common/Icon';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { FIXED_AREA_DROPPABLE } from '@/ui/dnd/types';
import { CREATE_FOLDER_REQUEST_EVENT } from '@/ui/fixed/events';
import { FolderRow } from './FolderRow';

interface CreateFolderRequest {
  name: string;
  tabIds: number[];
}

/** 固定空间区域：header（折叠/新建）+ 文件夹列表（复用分组卡片视觉），
 *  整体是 useDroppable 目标（拖标签/分组到空白处创建新文件夹）。 */
export function FixedArea() {
  const { t } = useTranslation();
  const folders = useDataStore((state) => state.folders);
  const createFolder = useDataStore((state) => state.createFolder);
  const addTabsToFolder = useDataStore((state) => state.addTabsToFolder);
  const tryUpdateSettings = useDataStore((state) => state.tryUpdateSettings);
  const settings = useDataStore((state) => state.settings);
  const notify = useUndoStore((state) => state.notify);
  const notifyError = useUndoStore((state) => state.notifyError);
  const [creating, setCreating] = useState(false);
  const [dropRequest, setDropRequest] = useState<CreateFolderRequest | null>(null);
  // 固定空间折叠：文件夹一多就首次自动折叠，避免 34vh 独立滚动区把标签列表
  // 挤到折叠线以下。阈值取 2 而非 5：侧边栏窄，两个文件夹已足以占满
  // 一屏，首屏的主角应当是标签列表。
  // 用户手动切换后（非 null）遵循用户选择，不再按阈值自动改变。
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  // 拖拽期间强制展开：折叠时 `{!collapsed && children}` 不挂载任何文件夹，
  // 投放只能落到外壳上 —— 而落到外壳的语义是「按标签标题新建一个文件夹」
  // （见 useTabDragHandlers 的 FIXED_AREA_DROPPABLE 分支）。阈值 2 意味着
  // 只要有两个以上文件夹，一次正常的「拖进阅读清单」就会误建成新文件夹。
  // 拖拽开始即展开，让真实文件夹成为可投放目标。
  const [dragExpanded, setDragExpanded] = useState(false);
  /** 概念说明的手动开关（与首启自动展示的 conceptsSeen 相互独立）。 */
  const [showConcepts, setShowConcepts] = useState(false);
  useDndMonitor({
    onDragStart: () => setDragExpanded(true),
    onDragEnd: (event) => {
      const overId = event.over?.id;
      // 确实投进了某个文件夹才把展开固化下来（否则拖完又折回去，
      // 用户看不到刚放进去的条目）；只是拖标签排序则恢复原状态。
      const droppedIntoFolder = typeof overId === 'string' && overId.startsWith('folder:');
      setDragExpanded(false);
      if (droppedIntoFolder) setCollapsedOverride(false);
    },
    onDragCancel: () => setDragExpanded(false)
  });
  // 阈值取 5 而非 2：2 意味着用户刚建到第三个文件夹，固定空间就自动收起，
  // 「我建的文件夹一刷新就收起来了」—— 阈值必须高于「刚开始用」的规模。
  const collapsed = dragExpanded ? false : (collapsedOverride ?? folders.length > 5);
  // 不订阅 tabs：它仅用于建文件夹弹窗确认时的一次性过滤，订阅会让每次标签快照
  // 都重渲染整个固定区。事件期经 getState 读最新值即可（与其它 handler 同一约定）。
  const folderSortableIds = useMemo(
    () => folders.map((folder) => `folder:${folder.id}`),
    [folders]
  );
  const { isOver, setNodeRef } = useDroppable({
    id: FIXED_AREA_DROPPABLE,
    data: { type: 'fixed-area' }
  });
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
  // 传 collapsed 作重挂信号：折叠闸门 `{!collapsed && children}` 会**整体替换**
  // 内容层节点，而 hook 默认只在挂载时跑一次——不重挂的话它观察的还是上一个
  // 已失效的内容节点，展开/折叠后渐隐状态不再更新。
  useScrollFade(scrollRef, collapsed);

  const handleConfirmDrop = (name: string) => {
    const request = dropRequest;
    setDropRequest(null);
    if (!request) return;
    const targetTabs = useTabStore.getState().tabs.filter((tab) => request.tabIds.includes(tab.id));
    void (async () => {
      const folder = await createFolder(name);
      await addTabsToFolder(targetTabs, folder.id);
      // 新建的文件夹可能落在固定空间的滚动区之外（固定区上限 34vh），
      // 不给反馈的话用户会以为「拖过去没反应」。
      notify(t('已新建文件夹'));
    })().catch(() => notifyError(t('操作失败，请稍后重试')));
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
          /* 身份标识不用容器边框（会与密集列表的扁平语言冲突），
             改用标题前的品牌色条 —— 与原生组/站点组的强调色条同一套语言，
             但取品牌色表示「这是长期资产的归口」，与临时分组区分。 */
          accent="var(--c-brand-500)"
          icon={
            <Icon
              d={Icons.chevron}
              className={'h-3.5 w-3.5 transition-transform' + (collapsed ? '' : ' rotate-90')}
            />
          }
          onToggle={() => setCollapsedOverride(!collapsed)}
          collapsed={collapsed}
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
      {/* 弹窗必须脱离 CategoryModule 的折叠闸门（{!collapsed && children}）：
          折叠态下点「+」/拖入命名若被闸门挡住不挂载，会表现为点了没反应
          （FolderRow / sectionCards 同型陷阱）。弹窗经 Portal 挂到 body。 */}
      {creating && (
        <PromptDialog
          title={t('新建文件夹')}
          /* 空输入框 + 聚焦态边框在无 placeholder 时会被误读为「出错了」：
             补上示例文案，同时让「确定」为何禁用（空值）一目了然。 */
          placeholder={t('文件夹名称')}
          onConfirm={(name) => {
            setCreating(false);
            void createFolder(name).then(
              () => notify(t('已新建文件夹')),
              () => notifyError(t('操作失败，请稍后重试'))
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
