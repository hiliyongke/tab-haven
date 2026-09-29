import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReadLaterItem } from '@/core/schema/models';
import { isReadLaterStale } from '@/core/readlater/staleness';
import { createNewTab, updateTabUrl } from '@/platform/tabs';
import { useUndoStore } from '@/stores/undoStore';
import { Favicon } from '@/ui/common/Favicon';
import { Icon, Icons } from '@/ui/common/Icon';
import { useTabStore } from '@/stores/tabStore';

/**
 * 稍后读分区（C3）：未读点 + 时长 + 读完成灰 + 7 天过期提示与一键归档。
 *
 * 条目来源：右键菜单（页面/标签）与命令面板「稍后读当前标签」；
 * 点击条目 = 在当前窗口打开该 URL 并标记已读（一次性消费语义）。
 */
export function ReadLaterSection({
  items,
  onMarkRead,
  onMarkAllRead,
  onRemove,
  onArchiveStale
}: {
  items: readonly ReadLaterItem[];
  onMarkRead: (item: ReadLaterItem) => void;
  onMarkAllRead: () => void;
  onRemove: (item: ReadLaterItem) => void;
  /** 归档全部过期未读条目（进快照 + 清出暂存区）。 */
  onArchiveStale: (stale: readonly ReadLaterItem[]) => void;
}) {
  const { t } = useTranslation();
  const windowId = useTabStore((state) => state.currentWindowId);
  const notifyError = useUndoStore((state) => state.notifyError);

  const unreadCount = useMemo(
    () => items.filter((item) => item.readAt === undefined).length,
    [items]
  );
  const staleItems = useMemo(() => items.filter((item) => isReadLaterStale(item)), [items]);

  const openItem = useCallback(
    async (item: ReadLaterItem) => {
      // 复用固定条目「新建 + 改 URL」的打开路径（豁免/位置策略已内建）。
      // 失败必须提示：静默失败会让「点了条目没反应」，而条目还占着未读位。
      const created = await createNewTab(windowId).catch(() => null);
      if (!created) {
        notifyError(t('errors.operationFailed'));
        return;
      }
      if (await updateTabUrl(created.id, item.url)) {
        onMarkRead(item);
      } else {
        notifyError(t('errors.operationFailed'));
      }
    },
    [windowId, notifyError, onMarkRead, t]
  );

  if (items.length === 0) return null;

  return (
    <section className="mb-1" aria-label={t('readlater.sectionLabel')}>
      <div className="mx-1 mb-1 rounded-lg bg-warn-50 px-2.5 py-1.5">
        <p className="flex items-center gap-1.5 text-3xs text-warn-700">
          <Icon d={Icons.bookmarkAdd} className="h-3.5 w-3.5 shrink-0 text-warn-600" />
          <span className="font-semibold">{t('readlater.banner', { count: unreadCount })}</span>
          <span className="flex-1" />
          {unreadCount > 0 && (
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 text-3xs text-warn-700 hover:bg-warn-100"
              onClick={onMarkAllRead}
            >
              {t('readlater.markAllRead')}
            </button>
          )}
        </p>
        {staleItems.length > 0 && (
          <p className="mt-1 flex items-center gap-1.5 text-3xs text-warn-700">
            <span className="flex-1">{t('readlater.staleHint', { count: staleItems.length })}</span>
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 font-medium text-warn-700 hover:bg-warn-100"
              onClick={() => onArchiveStale(staleItems)}
            >
              {t('readlater.archiveStale')}
            </button>
          </p>
        )}
      </div>
      <div className="mx-1 rounded-lg border border-gray-100 bg-surface" role="list">
        {items.map((item) => {
          const unread = item.readAt === undefined;
          return (
            <div
              key={item.id}
              role="listitem"
              className={
                'flex min-w-0 items-center gap-1.5 border-b border-gray-50 px-2.5 py-1.5 last:border-b-0 ' +
                (unread ? '' : 'opacity-55')
              }
            >
              {unread && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden />
              )}
              <Favicon src={item.favIconUrl} title={item.title} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-3xs text-gray-700 hover:text-accent-700"
                title={item.url}
                onClick={() => void openItem(item)}
              >
                {item.title || item.url}
              </button>
              {unread ? (
                <button
                  type="button"
                  className="shrink-0 rounded px-1 py-0.5 text-3xs text-gray-400 hover:text-accent-600"
                  title={t('readlater.markRead')}
                  aria-label={t('readlater.markRead')}
                  onClick={() => onMarkRead(item)}
                >
                  ✓
                </button>
              ) : (
                <span className="shrink-0 text-3xs text-gray-300">
                  {/* 无角色 span 上的 aria-label 不保证被播报：改为读屏文本 + 装饰符号 */}
                  <span className="sr-only">{t('readlater.read')}</span>
                  <span aria-hidden>✓</span>
                </span>
              )}
              <button
                type="button"
                className="shrink-0 rounded px-1 py-0.5 text-3xs text-gray-400 hover:text-red-600"
                title={t('readlater.remove')}
                aria-label={t('readlater.remove')}
                onClick={() => onRemove(item)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
