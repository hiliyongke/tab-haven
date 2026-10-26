import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useDataStore } from '@/stores/dataStore';
import { useUndoStore } from '@/stores/undoStore';
import { DialogShell } from '@/ui/dialog/Dialog';
import {
  getRecentlyClosed,
  restoreRecentClosed,
  type RecentClosedEntry
} from '@/platform/sessions';
import { hostnameOf } from '@/core/url/UrlInspector';
import { logDegraded } from '@/platform/diagnostics';
import { formatRelative, formatTime, minutesSince } from '@/ui/common/format';
import { Button } from '@/ui/common/Button';
import { EmptyState } from '@/ui/common/EmptyState';

/**
 * 撤销历史面板：
 *  - Tabs撤销栈：列出全部批次，点击任意批次一键恢复（回溯任意一步）；
 *  - 浏览器最近关闭：chrome.sessions 记录的原生关闭标签/窗口，一键恢复。
 */

/**
 * 批次来源标签：让用户知道这批关闭是「我手动关的」还是「归档带走的」。
 *
 * 所有批次长得一样时，用户回看历史分不清操作来源 —— 而「自动行为发生在
 * 我不知情时」正是最容易引发不信任的场景，来源必须显式。
 * 未知 kind 返回 null（不显示标签）：schema 里 kind 是自由字符串，
 * 未知来源一律不显示标签，避免显示成错误的标签。
 */
function kindLabel(kind: string, t: (key: string) => string): string | null {
  if (kind === 'archive') return t('窗口归档');
  // 'restore'（R8）：快照恢复新建的标签。撤销它 = 关闭这批标签，可再撤销回来。
  if (kind === 'restore') return t('快照恢复');
  // 'restore-undo'：撤销一次快照恢复时关闭的那批标签（可再撤销把它们开回来）。
  if (kind === 'restore-undo') return t('撤销快照恢复');
  if (kind === 'close') return t('手动关闭');
  return null;
}

export function UndoHistoryPanel({
  hasSnapshots,
  onOpenSnapshots,
  onClose
}: {
  hasSnapshots: boolean;
  onOpenSnapshots: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const batches = useUndoStore((state) => state.batches);
  const undoBatch = useUndoStore((state) => state.undoBatch);
  const notify = useUndoStore((state) => state.notify);
  const notifyFailure = useUndoStore((state) => state.notifyFailure);
  // 经订阅而非 `useDataStore.getState()`：后者不建立订阅，用户在设置页调大上限后
  // 这行仍显示旧值 —— 而文案恰恰在引导用户去改这个设置。
  const undoStackLimit = useDataStore((state) => state.settings.undoStackLimit);
  /**
   * 重做栈与执行入口。
   *
   * 重做只有「撤销成功后 toast 上的一次性按钮」这一个出口时，toast 默认 7 秒
   * 后消失（settings.toastDurationSec）—— 功能建成却几乎触达不到。这里补常驻出口：
   * redoing 期间禁用，与撤销共用执行互斥（store 内以 undoing / redoing 判定）。
   */
  const redoBatches = useUndoStore((state) => state.redoBatches);
  const redo = useUndoStore((state) => state.redo);
  const redoing = useUndoStore((state) => state.redoing);
  const [recent, setRecent] = useState<RecentClosedEntry[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  /**
   * 恢复互斥必须走 ref：restoringId 是渲染期 state，同一 tick 内的连击读到的
   * 都是旧值 null（按钮的 disabled 也要等重渲染才生效），两行会同时进入执行体。
   * restoringId 保留为展示态（哪一行在恢复中）。
   */
  const restoringRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getRecentlyClosed()
      .then((entries) => {
        if (!cancelled) setRecent(entries);
      })
      .catch((error: unknown) => {
        // 失败会被渲染成与「无最近关闭」相同的空态：必须留痕，否则故障不可分辨。
        logDegraded('sessions', '读取浏览器最近关闭列表失败', error);
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRestoreRecent = (entry: RecentClosedEntry) => {
    // 恢复互斥：并发点击不同行会互相覆盖 restoringId，
    // 先完成的回调把另一行提前解禁。
    if (restoringRef.current) return;
    restoringRef.current = true;
    setRestoringId(entry.sessionId);
    void restoreRecentClosed(entry.sessionId)
      .then((ok) => {
        // 失败走 notifyError（role="alert"）：与抛错分支同一语义强度。
        if (ok) {
          notify(t('已从浏览器最近关闭中恢复'));
          // 已恢复的 sessionId 立即失效：留在本列表里再点必然失败
          // （浏览器侧该会话已不存在），点了「没反应」比消失更费解。
          setRecent((prev) => prev?.filter((item) => item.sessionId !== entry.sessionId) ?? null);
        }
        // ok === false 同样要留痕：否则「点了恢复没反应」在诊断里没有对应条目。
        else notifyFailure('sessions', t('操作失败，请稍后重试'), undefined);
      })
      .catch((error: unknown) => {
        // sessions.restore 抛错（sessionId 失效等）：必须经 finally 复位，
        // 否则该按钮永久 disabled 卡死。
        notifyFailure('sessions', t('操作失败，请稍后重试'), error);
      })
      .finally(() => {
        restoringRef.current = false;
        setRestoringId(null);
      });
  };

  const hasAny =
    batches.length > 0 || redoBatches.length > 0 || (recent !== null && recent.length > 0);

  return (
    <DialogShell title={t('撤销历史')} onClose={onClose} widthClassName="dialog-md">
      {/* 滚动交给 DialogShell 的内容区（标题栏与底栏常驻可见），这里不再自套
          一层 max-h + overflow —— 两层滚动容器会让滚动条出现两次、高度打架。 */}
      {/* 不再加 pr-1：内容区 px-4 之外再多 4px，列表右边缘与标题栏 × 差 4px。
          滚动条留白由内容区自身的 padding 承担。 */}
      <div>
        {/* 空态复用通用 EmptyState：与弹窗 / 侧栏的空态同构，文案仍取 undo.historyEmpty。 */}
        {!hasAny && <EmptyState title={t('暂无撤销记录')} />}

        {/* D5.3 崩溃引导：撤销与浏览器最近关闭都为空，但存在快照时，提示用户从快照找回。 */}
        {!hasAny && hasSnapshots && (
          <div className="mx-1 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs text-accent-700">
            <p>{t('本会话的撤销记录为空，但你有过自动保存的快照，可从快照找回整个窗口。')}</p>
            {/* 复用统一按钮（与 ListStates 空态同款）：这里手写一份 accent
                原子类会改主题/圆角要改两处，且越界令牌的悬停会静默失效。 */}
            <Button variant="soft-outline" size="xs" className="mt-1" onClick={onOpenSnapshots}>
              {t('查看我的快照')}
            </Button>
          </div>
        )}

        {/* 栈深是「可找回」承诺的边界，但只在淘汰那一刻提示过一次（且同会话
            只提示一次）。常驻一行让用户随时知道「保留最近 N 条」，
            避免回溯时才发现记录已被挤掉。 */}
        {batches.length > 0 && (
          <p className="mb-1.5 text-3xs text-gray-500">
            {t('保留最近 {{count}} 条关闭记录，可在设置中调大上限', {
              count: undoStackLimit
            })}
          </p>
        )}

        {batches.length > 0 && (
          <section className="mb-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              {/* 分组小标题统一口径（与 SnapshotsPanel / CommandPalette / AboutPage 一致）：
                  11px + font-medium + tracking-wide + gray-500 */}
              <h3 className="text-3xs font-medium tracking-wide text-gray-500">
                {/* 纯中文：品牌名嵌进中文短语（「Tabs撤销」）会在中文界面留下
                    中英混排且缺空格的读法，英文模式下又会被整句译掉品牌词。 */}
                {t('撤销')} · {batches.length}
              </h3>
              {/* 重做常驻出口：仅在有可重做项时出现（与「清理重复」同款条件出现模式）。
                  文案带数量，让「这次会再关掉几个」在按下前可见。 */}
              {redoBatches.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={redoing}
                  onClick={() => void redo()}
                  title={t('再次关闭刚恢复的 {{count}} 个标签（可再次撤销）', {
                    count: redoBatches[0]?.entries.length ?? 0
                  })}
                >
                  {t('重做')}
                </Button>
              )}
            </div>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {[...batches].reverse().map((batch) => (
                <li key={batch.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50"
                    onClick={() => void undoBatch(batch.id)}
                    title={t('恢复该批次关闭的标签')}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-700">
                      {batch.entries[0]
                        ? hostnameOf(batch.entries[0]?.url) || batch.entries[0]?.url
                        : '·'}
                      {batch.entries.length > 1 ? ` +${batch.entries.length - 1}` : ''}
                    </span>
                    {kindLabel(batch.kind, t) && (
                      <span className="chip chip--cjk shrink-0 rounded bg-gray-100 px-1 py-px text-gray-600">
                        {kindLabel(batch.kind, t)}
                      </span>
                    )}
                    <span className="shrink-0 text-2xs text-gray-500">
                      {/* 撤销历史是「刚刚发生」的场景，读「12/3 14:07」比读「刚刚」
                          慢一拍；1 小时内走相对文案，之外走日期自适应格式。 */}
                      {minutesSince(batch.createdAt) < 1
                        ? t('刚刚')
                        : minutesSince(batch.createdAt) < 60
                          ? t('{{count}} 分钟前', { count: minutesSince(batch.createdAt) })
                          : formatRelative(batch.createdAt)}
                      {/* 量词不能裸写：英文模式会残留「个」。整句进词典。 */}·{' '}
                      {t('共 {{count}} 个', { count: batch.entries.length })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recent !== null && recent.length > 0 && (
          <section>
            <h3 className="mb-1 text-3xs font-medium tracking-wide text-gray-500">
              {t('浏览器最近关闭')} · {recent.length}
            </h3>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {recent.map((entry) => (
                <li key={entry.sessionId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50"
                    onClick={() => handleRestoreRecent(entry)}
                    disabled={restoringId !== null}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-700">
                        {entry.isWindow
                          ? t('窗口（{{count}} 个标签）', { count: entry.tabCount ?? 0 })
                          : entry.title || entry.url || '·'}
                      </span>
                      {!entry.isWindow && (
                        <span className="block truncate text-2xs text-gray-500">
                          {hostnameOf(entry.url) || '·'}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-2xs text-gray-500">
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
