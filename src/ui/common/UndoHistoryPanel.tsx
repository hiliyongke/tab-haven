import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUndoStore } from '@/stores/undoStore';
import { DialogShell } from '@/ui/dialog/Dialog';
import { getRecentlyClosed, restoreRecentClosed, type RecentClosedEntry } from '@/platform/sessions';

/**
 * 撤销历史面板（FR-D8.1 后半 + E11 会话桥接）：
 *  - 本产品撤销栈：列出全部批次，点击任意批次一键恢复（回溯任意一步）；
 *  - 浏览器最近关闭：chrome.sessions 记录的原生关闭标签/窗口，一键恢复。
 */

function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function UndoHistoryPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const batches = useUndoStore((state) => state.batches);
  const undoBatch = useUndoStore((state) => state.undoBatch);
  const notify = useUndoStore((state) => state.notify);
  const [recent, setRecent] = useState<RecentClosedEntry[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getRecentlyClosed()
      .then((entries) => {
        if (!cancelled) setRecent(entries);
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRestoreRecent = (entry: RecentClosedEntry) => {
    setRestoringId(entry.sessionId);
    void restoreRecentClosed(entry.sessionId).then((ok) => {
      setRestoringId(null);
      notify(ok ? t('undo.recentRestored') : t('errors.operationFailed'));
    });
  };

  const hasAny = batches.length > 0 || (recent !== null && recent.length > 0);

  return (
    <DialogShell title={t('undo.historyTitle')} onClose={onClose} widthClassName="w-[min(440px,92vw)]">
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {!hasAny && (
          <p className="py-6 text-center text-xs text-gray-400">{t('undo.historyEmpty')}</p>
        )}

        {batches.length > 0 && (
          <section className="mb-3">
            <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-gray-400">
              {t('undo.historyOwn')} · {batches.length}
            </h3>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {[...batches].reverse().map((batch) => (
                <li key={batch.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-gray-50"
                    onClick={() => void undoBatch(batch.id)}
                    title={t('undo.restoreBatch')}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-700">
                      {batch.entries[0]
                        ? hostnameOf(batch.entries[0]?.url) || batch.entries[0]?.url
                        : '·'}
                      {batch.entries.length > 1 ? ` +${batch.entries.length - 1}` : ''}
                    </span>
                    <span className="shrink-0 text-2xs text-gray-400">
                      {formatTime(batch.createdAt)} · {batch.entries.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recent !== null && recent.length > 0 && (
          <section>
            <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-gray-400">
              {t('undo.historyBrowser')} · {recent.length}
            </h3>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {recent.map((entry) => (
                <li key={entry.sessionId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-gray-50"
                    onClick={() => handleRestoreRecent(entry)}
                    disabled={restoringId === entry.sessionId}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-700">
                        {entry.isWindow
                          ? t('undo.recentWindow', { count: entry.tabCount ?? 0 })
                          : entry.title || entry.url || '·'}
                      </span>
                      {!entry.isWindow && (
                        <span className="block truncate text-2xs text-gray-400">
                          {hostnameOf(entry.url) || '·'}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-2xs text-gray-400">
                      {restoringId === entry.sessionId ? '…' : formatTime(entry.lastModified)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DialogShell>
  );
}
