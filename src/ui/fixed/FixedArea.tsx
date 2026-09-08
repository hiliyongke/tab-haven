import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { PromptDialog } from '@/ui/dialog/Dialog';
import { CategoryModule } from '@/ui/common/CategoryModule';
import { FixedConceptsMap } from '@/ui/common/FixedConceptsMap';
import { Icon, Icons } from '@/ui/common/Icon';
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
  const [creating, setCreating] = useState(false);
  const [dropRequest, setDropRequest] = useState<CreateFolderRequest | null>(null);
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
      notify(t('toast.folderCreated'));
    })().catch(() => notify(t('errors.operationFailed')));
  };

  return (
    <SortableContext items={folderSortableIds} strategy={verticalListSortingStrategy}>
      <CategoryModule
        title={t('fixed.areaTitle')}
        count={folders.length}
        aria-label={t('fixed.areaLabel')}
        className="module-shell fixed-area"
        setNodeRef={setNodeRef}
        isOver={isOver}
        action={
          <button
            type="button"
            className="row-action"
            title={t('fixed.newFolder')}
            aria-label={t('fixed.newFolder')}
            onClick={() => setCreating(true)}
          >
            <Icon d={Icons.plus} className="h-3.5 w-3.5" />
            <span className="sr-only">{t('fixed.newFolder')}</span>
          </button>
        }
      >
        {folders.length === 0 && (
          <>
            <p className="fixed-area-empty">{t('fixed.emptyHint')}</p>
            {!settings.conceptsSeen && (
              <div className="relative mt-1">
                <FixedConceptsMap />
                <button
                  type="button"
                  className="absolute right-1 top-0.5 shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium text-gray-400 transition-base hover:bg-gray-100 hover:text-gray-600"
                  onClick={() => void tryUpdateSettings({ conceptsSeen: true })}
                  title={t('fixed.dismissConcepts')}
                >
                  {t('fixed.dismissConcepts')}
                </button>
              </div>
            )}
          </>
        )}
        {folders.map((folder) => (
          <FolderRow key={folder.id} folder={folder} />
        ))}
        {creating && (
          <PromptDialog
            title={t('fixed.newFolderPrompt')}
            onConfirm={(name) => {
              setCreating(false);
              void createFolder(name).then(
                () => notify(t('toast.folderCreated')),
                () => notify(t('errors.operationFailed'))
              );
            }}
            onCancel={() => setCreating(false)}
          />
        )}
        {dropRequest && (
          <PromptDialog
            title={t('fixed.newFolderPrompt')}
            initialValue={dropRequest.name}
            onConfirm={handleConfirmDrop}
            onCancel={() => setDropRequest(null)}
          />
        )}
      </CategoryModule>
    </SortableContext>
  );
}
