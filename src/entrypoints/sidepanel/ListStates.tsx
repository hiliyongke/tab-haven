import { useTranslation } from 'react-i18next';
import { createPlainNewTab } from '@/platform/tabs';
import { EmptyState } from '@/ui/common/EmptyState';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 标签列表三态展示：加载骨架 / 无标签 / 搜索无结果。
 * 空态复用通用 EmptyState（sidepanel / popup 共用）。
 */

/** 数据加载中的骨架屏（区分「同步中」与「真的没有标签」）。
 *  结构对齐真实列表（分区头 + 行），加载完成后版面不跳。 */
export function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-1 py-1">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="skeleton h-3.5 w-0.5 shrink-0 rounded-full" />
        <span className="skeleton h-3 w-20" />
        <span className="skeleton h-3 w-6" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2 px-1.5 py-[7px]">
          <span className="skeleton h-4 w-4 shrink-0" />
          <span className="skeleton h-3 flex-1" />
          <span className="skeleton h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

/** 窗口内没有标签的空态（教学型：说明能做什么 + 一步动作）。 */
export function EmptyTabs() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Icon d={Icons.plus} className="h-4.5 w-4.5" />}
      title={t('empty.title')}
      hint={t('empty.hint')}
      action={
        <button
          type="button"
          className="mt-1 rounded-lg border border-accent-300 bg-accent-50 px-3 py-1.5 text-2xs font-medium text-accent-700 transition-base hover:bg-accent-100"
          onClick={() => void createPlainNewTab()}
        >
          {t('empty.openNewTab')}
        </button>
      }
    />
  );
}

/** 数据初始化失败（自动重试仍失败）：说明 + 手动重试出口，替代无出口的骨架屏。 */
export function LoadErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Icon d={Icons.infoAlert} className="h-4.5 w-4.5" />}
      title={t('errors.loadFailedTitle')}
      hint={t('errors.loadFailedHint')}
      action={
        <button
          type="button"
          className="mt-1 rounded-lg border border-accent-300 bg-accent-50 px-3 py-1.5 text-2xs font-medium text-accent-700 transition-base hover:bg-accent-100"
          onClick={onRetry}
        >
          {t('errors.retry')}
        </button>
      }
    />
  );
}

/** 搜索无结果空态（可一键清空搜索）。 */
export function NoSearchResults(props: { onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Icon d={Icons.search} className="h-4.5 w-4.5" />}
      title={t('search.noResults')}
      action={
        <button
          type="button"
          className="rounded px-2 py-1 text-2xs text-accent-600 transition-base hover:bg-accent-50"
          onClick={props.onClear}
        >
          {t('search.clear')}
        </button>
      }
    />
  );
}
