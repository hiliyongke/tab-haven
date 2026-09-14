import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { useTabStore } from '@/stores/tabStore';
import { useDataStore } from '@/stores/dataStore';
import { snapshotDiff } from '@/core/snapshot/snapshotDiff';
import { computeInsights } from '@/core/insights/tabInsights';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { ConfirmDialog, DialogShell } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { TextField } from '@/ui/common/TextField';
import { SnapshotRow } from '@/ui/common/SnapshotRow';

/**
 * 会话快照面板：命名快照、归档中心与 OneTab / Workona 导入。
 * 把当前窗口存为命名快照/空间，归档关闭并留档，从 OneTab / Workona 导入，
 * 查看本地周报（统计 + 习惯洞察）；恢复走 platform/restoreSnapshot，提示走 undoStore。
 */
export interface SnapshotsPanelProps {
  onClose: () => void;
  /** 习惯洞察行动出口（P-05）：由 App 注入既有 handler，面板内不重复实现。 */
  onCleanDuplicates: () => void;
  /** 一键休眠全部非激活标签（洞察「休眠候选」出口）。 */
  onDiscardInactive: () => void;
  /** 归档当前窗口（洞察「滞留预警」出口）。 */
  onArchiveWindow: () => void;
}

export function SnapshotsPanel({
  onClose,
  onCleanDuplicates,
  onDiscardInactive,
  onArchiveWindow
}: SnapshotsPanelProps) {
  const { t } = useTranslation();
  const snapshots = useSnapshotStore((state) => state.snapshots);
  const saveCurrentWindow = useSnapshotStore((state) => state.saveCurrentWindow);
  const saveSpace = useSnapshotStore((state) => state.saveSpace);
  const importOneTab = useSnapshotStore((state) => state.importOneTab);
  const importWorkona = useSnapshotStore((state) => state.importWorkona);
  const deleteSnapshot = useSnapshotStore((state) => state.deleteSnapshot);
  const renameSnapshot = useSnapshotStore((state) => state.renameSnapshot);
  const restore = useSnapshotStore((state) => state.restore);
  const restoreSelected = useSnapshotStore((state) => state.restoreSelected);
  const notify = useUndoStore((state) => state.notify);
  const notifyError = useUndoStore((state) => state.notifyError);

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [view, setView] = useState<'list' | 'import' | 'report'>('list');
  /** 导入源切换（OneTab 文本 / Workona JSON，P-09 迁移矩阵）。 */
  const [importSource, setImportSource] = useState<'onetab' | 'workona'>('onetab');
  const [importText, setImportText] = useState('');
  const [importName, setImportName] = useState('');
  /** 当前展开查看标签清单的快照 id（再次点击收起）。 */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 待删除确认的快照 id（快照是长期资产，删除不可撤销，必须二次确认）。 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** 正在恢复的快照 id：恢复会新建大量标签（耗时数百 ms），期间禁用该行按钮防双击并发。 */
  const [restoringId, setRestoringId] = useState<string | null>(null);
  /** 正在删除的快照 id：删除确认按钮连点防护（与 restoringId 同口径）。 */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /**
   * 勾选集（P-02 选择性恢复）：键为 `${index}-${tab.url}`（与 SnapshotRow 行键一致）。
   * 勾选是「从完整恢复里剔除若干条」，语义上必须**默认全选**——用户展开详情
   * 是为了取消某几条，而不是从零挑起。detailId 切换时重置为新快照的全选集。
   */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const ordered = useMemo(
    () => [...snapshots].sort((a, b) => b.createdAt - a.createdAt),
    [snapshots]
  );

  /**
   * 响应式订阅：窗口标签与绑定标签 id（P-02 预览与 P-05 洞察共用）。
   * 窗口标签必须经订阅而非 getState 获取——面板打开期间窗口可能变化，
   * tab 变化触发重渲染并刷新 detailDiff 的 memo 缓存，保证预览始终基于「此刻的窗口」。
   */
  const tabs = useTabStore((state) => state.tabs);
  const boundTabIds = useDataStore((state) => state.boundTabIds);

  /**
   * 展开行的恢复预览 diff（P-02）：以当前窗口已打开 URL 键集合为基准，
   * 三分类（将新建 / 已存在 / 不恢复）让「恢复会带来什么」决策前可见。
   * 依赖数组显式含 tabs：标签变化即缓存失效重算，修复此前 getState 取值
   * 导致窗口变化后预览 diff 停留在旧值的问题（窗口标签量级 < 500，开销可忽略）。
   */
  const detailDiff = useMemo(() => {
    const detailSnap = ordered.find((snap) => snap.id === detailId);
    if (!detailSnap) return undefined;
    const existingKeys = new Set<string>();
    for (const tab of tabs) {
      const key = webComparisonKey(tab.url, tab.pendingUrl);
      if (key) existingKeys.add(key);
    }
    return snapshotDiff(detailSnap.tabs, existingKeys);
  }, [detailId, ordered, tabs]);

  /** 勾选键 → 快照条目（按行键直接索引，避免恢复时 O(n) 反查）。 */
  /** 展开/收起时重置勾选集为该快照的「默认全选」（仅可恢复条目）。 */
  const toggleDetail = (id: string) => {
    const next = detailId === id ? null : id;
    setDetailId(next);
    const snap = next === null ? undefined : ordered.find((entry) => entry.id === next);
    if (!snap) {
      setSelectedKeys(new Set());
      return;
    }
    // 默认全选 = 全部条目键（不可恢复条目勾选了也不会被恢复，恢复端有兜底过滤）。
    setSelectedKeys(new Set(snap.tabs.map((tab, index) => `${index}-${tab.url}`)));
  };

  /** 勾选切换（P-02）。 */
  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /**
   * 按生命周期分组展示（概念收敛）：
   * 命名快照（手动 + 轻量空间）/ 归档 / 关窗自动保存。
   *
   * 此前四种 origin 混排在一个列表里，只靠徽标区分——用户无法判断
   * 「这个对象是持续更新的、已经关闭标签的、还是系统自动兜底的」。
   * 分组后每组语义唯一，恢复预期才能对齐。
   */
  const groups = useMemo(
    () =>
      [
        {
          key: 'named' as const,
          title: t('snapshots.groupNamed'),
          desc: t('snapshots.groupNamedDesc'),
          items: ordered.filter((snap) => snap.origin === 'manual' || snap.origin === 'space')
        },
        {
          key: 'archive' as const,
          title: t('snapshots.groupArchive'),
          desc: t('snapshots.groupArchiveDesc'),
          items: ordered.filter((snap) => snap.origin === 'archive')
        },
        {
          key: 'auto' as const,
          title: t('snapshots.groupAuto'),
          desc: t('snapshots.groupAutoDesc'),
          items: ordered.filter((snap) => snap.origin === 'auto')
        }
      ].filter((group) => group.items.length > 0),
    [ordered, t]
  );

  /** 保存进行中标尺：await 期间输入框仍在，Enter 连击/双击会并发提交出重复快照。 */
  const saveInFlight = useRef(false);

  const handleSave = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      await saveCurrentWindow(name.trim() || undefined);
      setName('');
      notify(t('snapshots.saved'));
    } catch {
      notifyError(t('errors.operationFailed'));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const handleSaveSpace = async () => {
    try {
      await saveSpace(t('snapshots.space'));
      notify(t('snapshots.saved'));
    } catch {
      notifyError(t('errors.operationFailed'));
    }
  };

  const handleImport = async () => {
    try {
      if (importSource === 'workona') {
        const result = await importWorkona(importText);
        if (result.snapshots === 0) {
          // 区分「没粘贴内容」与「解析不出 workspace」：后者可能是格式不对
          // 或全部条目都不是 http(s) 网址（skipped 会给出识别量提示）。
          notify(
            importText.trim()
              ? result.skipped > 0
                ? t('snapshots.importWorkonaSkipped', { count: result.skipped })
                : t('snapshots.importUnparsed')
              : t('snapshots.empty')
          );
          return;
        }
        notify(
          t('snapshots.importWorkonaDone', {
            snapshots: result.snapshots,
            tabs: result.tabs
          })
        );
        setImportText('');
        setImportName('');
        setView('list');
        return;
      }
      const count = await importOneTab(importText, importName.trim() || undefined);
      if (count === 0) {
        // 区分「用户没粘贴内容」与「粘贴了但解析不出条目」：后者可能是因为
        // 超 1MB 被直接拒收，或整段都不是 http(s) 网址。笼统提示「快照为空」
        // 会让用户以为导入成功却得到一个空快照，无从排查。
        notify(importText.trim() ? t('snapshots.importUnparsed') : t('snapshots.empty'));
        return;
      }
      notify(t('snapshots.imported', { count }));
      setImportText('');
      setImportName('');
      setView('list');
    } catch {
      notifyError(t('errors.operationFailed'));
    }
  };

  const handleRestore = async (id: string, tabCount: number) => {
    if (tabCount === 0) {
      notify(t('snapshots.empty'));
      return;
    }
    // 互斥：恢复期间再点会基于同一窗口现状并发 create，可能把同一批标签开两份
    // （快照恢复没有 undo 栈式的 undoInFlight 互斥，这里在组件层补上）。
    if (restoringId !== null) return;
    setRestoringId(id);
    try {
      const count = await restore(id);
      notify(t('snapshots.restored', { count }));
      onClose();
    } catch {
      notifyError(t('errors.operationFailed'));
    } finally {
      setRestoringId(null);
    }
  };

  /**
   * 选择性恢复（P-02）：按当前勾选集恢复。勾选集为空提示用户先勾选；
   * 恢复互斥与 handleRestore 共用 restoringId（同一时刻只允许一个恢复在途）。
   */
  const handleRestoreSelected = async (id: string, tabCount: number) => {
    if (tabCount === 0) {
      notify(t('snapshots.restoreSelectedEmpty'));
      return;
    }
    if (restoringId !== null) return;
    const snap = snapshots.find((entry) => entry.id === id);
    if (!snap) return;
    const selectedTabs = snap.tabs.filter((tab, index) => selectedKeys.has(`${index}-${tab.url}`));
    if (selectedTabs.length === 0) {
      notify(t('snapshots.restoreSelectedEmpty'));
      return;
    }
    setRestoringId(id);
    try {
      const count = await restoreSelected(id, selectedTabs);
      notify(t('snapshots.restored', { count }));
      onClose();
    } catch {
      notifyError(t('errors.operationFailed'));
    } finally {
      setRestoringId(null);
    }
  };

  const performDelete = async (id: string) => {
    setConfirmDeleteId(null);
    // 互斥：确认弹窗按钮快速连点会并发触发两次 deleteSnapshot（同 id 双写竞态）。
    // 与 handleRestore 的 restoringId、handleSave 的 saveInFlight 同一口径。
    if (deletingId !== null) return;
    setDeletingId(id);
    try {
      await deleteSnapshot(id);
    } catch {
      notifyError(t('errors.operationFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  const beginRename = (id: string, current: string) => {
    setEditingId(id);
    setEditingName(current);
  };
  const commitRename = async () => {
    try {
      if (editingId) await renameSnapshot(editingId, editingName);
    } catch {
      notifyError(t('errors.operationFailed'));
    } finally {
      setEditingId(null);
      setEditingName('');
    }
  };

  const handleDelete = (id: string) => {
    // 快照（尤其归档/手动）是长期资产，单击删除不可恢复且相邻操作多、易误触。
    // 先弹确认，确认后由 performDelete 执行。
    setConfirmDeleteId(id);
  };

  const weekStart = Date.now() - 7 * 24 * 3600 * 1000;
  const weekSnaps = snapshots.filter((s) => s.createdAt >= weekStart);
  const weekArchives = weekSnaps.filter((s) => s.origin === 'archive').length;
  const weekSpaces = weekSnaps.filter((s) => s.origin === 'space').length;
  const weekSnapCount = weekSnaps.length;
  const weekTabs = weekSnaps.reduce((sum, s) => sum + s.tabCount, 0);

  /**
   * 习惯洞察（P-05）：当前窗口实时计算。tabs / boundTabIds 已在上方订阅，
   * 洞察对象是「此刻的窗口」，面板打开期间标签关闭/打开都应反映。
   * 周报统计块与洞察块共用一次 useMemo 各自独立，互不干扰重算。
   */
  const insights = useMemo(() => computeInsights(tabs, new Set(boundTabIds)), [tabs, boundTabIds]);

  return (
    <DialogShell title={t('snapshots.title')} onClose={onClose} widthClassName="dialog-md">
      {view === 'import' ? (
        <div className="flex flex-col gap-2">
          {/* 源切换：OneTab 文本 / Workona JSON（迁移矩阵入口，互斥单选） */}
          <div
            role="tablist"
            aria-label={t('snapshots.importSourceLabel')}
            className="flex gap-1 self-start rounded-lg border border-gray-200 bg-gray-50 p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={importSource === 'onetab'}
              className={
                'rounded px-2 py-1 text-2xs font-medium transition-base ' +
                (importSource === 'onetab'
                  ? 'bg-surface text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700')
              }
              onClick={() => setImportSource('onetab')}
            >
              {t('snapshots.importOneTab')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={importSource === 'workona'}
              className={
                'rounded px-2 py-1 text-2xs font-medium transition-base ' +
                (importSource === 'workona'
                  ? 'bg-surface text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700')
              }
              onClick={() => setImportSource('workona')}
            >
              {t('snapshots.importWorkona')}
            </button>
          </div>
          <p className="text-2xs text-gray-500">
            {importSource === 'onetab'
              ? t('snapshots.importOneTabHint')
              : t('snapshots.importWorkonaHint')}
          </p>
          {importSource === 'onetab' && (
            <TextField
              size="sm"
              placeholder={t('snapshots.namePlaceholder')}
              ariaLabel={t('snapshots.namePlaceholder')}
              value={importName}
              onChange={setImportName}
            />
          )}
          <TextField
            multiline
            className="h-40"
            placeholder={
              importSource === 'onetab'
                ? t('snapshots.importOneTabPlaceholder')
                : t('snapshots.importWorkonaPlaceholder')
            }
            ariaLabel={t('snapshots.importTitle')}
            value={importText}
            onChange={setImportText}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('list')}
            >
              {t('dialog.cancel')}
            </button>
            <button
              type="button"
              className="rounded bg-accent-600 px-2 py-1 text-2xs font-medium text-on-accent hover:bg-accent-700"
              onClick={() => void handleImport()}
            >
              {t('snapshots.importTitle')}
            </button>
          </div>
        </div>
      ) : view === 'report' ? (
        <div className="flex flex-col gap-3">
          <p className="text-2xs text-gray-600">{t('snapshots.reportHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekSnapCount}</p>
              <p className="text-2xs text-gray-500">{t('snapshots.reportSnapshots')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekArchives}</p>
              <p className="text-2xs text-gray-500">{t('snapshots.reportArchives')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekSpaces}</p>
              <p className="text-2xs text-gray-500">{t('snapshots.space')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekTabs}</p>
              <p className="text-2xs text-gray-500">{t('snapshots.reportTabs')}</p>
            </div>
          </div>
          {/* 习惯洞察（P-05）：从当前窗口实时推导行动建议，全部本地计算。
              出口指向已有动作（清理重复 / 一键休眠 / 归档窗口），形成闭环。 */}
          <div className="flex flex-col gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2.5">
            <p className="text-2xs font-semibold text-accent-700">{t('insights.title')}</p>
            <p className="text-3xs leading-relaxed text-accent-700/90">{t('insights.subtitle')}</p>
            {insights.duplicateHotspots.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-3xs font-medium text-gray-600">
                  {t('insights.duplicatesTitle')}
                </p>
                {insights.duplicateHotspots.map((hotspot) => (
                  <p key={hotspot.host} className="text-3xs text-gray-600">
                    <span className="font-medium text-gray-800">{hotspot.host}</span>
                    {' · '}
                    {t('insights.duplicatesEntry', { count: hotspot.count })}
                  </p>
                ))}
                <button
                  type="button"
                  className="self-start rounded px-1.5 py-0.5 text-3xs font-medium text-accent-700 transition-base hover:bg-accent-100"
                  onClick={onCleanDuplicates}
                >
                  {t('insights.actionClean')}
                </button>
              </div>
            )}
            {insights.discardableCount > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-3xs font-medium text-gray-600">
                  {t('insights.discardableTitle')}
                </p>
                <p className="text-3xs text-gray-600">
                  {t('insights.discardableEntry', {
                    count: insights.discardableCount,
                    discarded: insights.discardedCount
                  })}
                </p>
                <button
                  type="button"
                  className="self-start rounded px-1.5 py-0.5 text-3xs font-medium text-accent-700 transition-base hover:bg-accent-100"
                  onClick={onDiscardInactive}
                >
                  {t('insights.actionDiscard')}
                </button>
              </div>
            )}
            {insights.staleTabs.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-3xs font-medium text-gray-600">{t('insights.staleTitle')}</p>
                {insights.staleTabs.map((stale) => (
                  <p key={stale.id} className="text-3xs text-gray-600">
                    <span className="font-medium text-gray-800">{stale.label}</span>
                    {' · '}
                    {t('insights.staleEntry', { days: stale.days })}
                  </p>
                ))}
                <button
                  type="button"
                  className="self-start rounded px-1.5 py-0.5 text-3xs font-medium text-accent-700 transition-base hover:bg-accent-100"
                  onClick={onArchiveWindow}
                >
                  {t('insights.actionArchive')}
                </button>
              </div>
            )}
            {insights.duplicateHotspots.length === 0 &&
              insights.discardableCount === 0 &&
              insights.staleTabs.length === 0 && (
                <p className="text-3xs text-gray-600">{t('insights.empty')}</p>
              )}
          </div>
          <button
            type="button"
            className="self-start rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
            onClick={() => setView('list')}
          >
            {t('dialog.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {!saving ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-accent-300 bg-accent-50 px-3 py-2 text-sm font-medium text-accent-700 transition-base hover:bg-accent-100"
                onClick={() => setSaving(true)}
              >
                <Icon d={Icons.snapshot} className="h-4 w-4" />
                {t('snapshots.saveCurrent')}
              </button>
              <button
                type="button"
                title={t('snapshots.saveSpaceHint')}
                className="flex items-center justify-center gap-2 rounded-lg border border-control bg-surface px-3 py-2 text-sm font-medium text-gray-600 transition-base hover:bg-gray-50"
                onClick={() => void handleSaveSpace()}
              >
                <Icon d={Icons.layers} className="h-4 w-4" />
                {t('snapshots.saveSpaceAction')}
                {/* 感叹号提醒：该按钮语义不直观（每次保存都新增一条，不覆盖），悬停看完整说明 */}
                <Icon d={Icons.infoAlert} className="h-3.5 w-3.5 text-gray-400" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-surface px-2 py-1.5">
              <Icon d={Icons.snapshot} className="h-4 w-4 shrink-0 text-gray-500" />
              <input
                type="text"
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 "
                placeholder={t('snapshots.namePlaceholder')}
                aria-label={t('snapshots.namePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSave();
                  if (event.key === 'Escape') {
                    setSaving(false);
                    setName('');
                  }
                }}
              />
              <button
                type="button"
                className="rounded bg-accent-600 px-2 py-1 text-2xs font-medium text-on-accent hover:bg-accent-700"
                onClick={() => void handleSave()}
              >
                {t('snapshots.save')}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
                onClick={() => {
                  setSaving(false);
                  setName('');
                }}
              >
                {t('dialog.cancel')}
              </button>
            </div>
          )}

          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
            {ordered.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-500">{t('snapshots.emptyHint')}</p>
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  <h3 className="mb-1 flex items-baseline gap-1 text-2xs font-medium text-gray-500">
                    {group.title}
                    <span className="text-gray-400">
                      {t('snapshots.groupCount', { count: group.items.length })}
                    </span>
                  </h3>
                  {group.desc && (
                    <p className="mb-1 text-3xs leading-snug text-gray-500">{group.desc}</p>
                  )}
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {group.items.map((snap) => (
                      <SnapshotRow
                        key={snap.id}
                        snap={snap}
                        isEditing={editingId === snap.id}
                        editingName={editingName}
                        isDetailOpen={detailId === snap.id}
                        onEditingNameChange={setEditingName}
                        onBeginRename={beginRename}
                        onCommitRename={commitRename}
                        onCancelRename={() => {
                          setEditingId(null);
                          setEditingName('');
                        }}
                        onToggleDetail={toggleDetail}
                        onRestore={handleRestore}
                        onDelete={handleDelete}
                        restoring={restoringId === snap.id}
                        diff={detailId === snap.id ? detailDiff : undefined}
                        selectedKeys={detailId === snap.id ? selectedKeys : undefined}
                        onToggleSelected={toggleSelected}
                        onRestoreSelected={handleRestoreSelected}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2 border-t border-gray-200 pt-2">
            <button
              type="button"
              className="flex-1 rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('import')}
            >
              {t('snapshots.importOneTab')}
            </button>
            <button
              type="button"
              className="flex-1 rounded px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('report')}
            >
              {t('snapshots.reportTitle')}
            </button>
          </div>
        </div>
      )}
      {confirmDeleteId !== null && (
        <ConfirmDialog
          title={t('dialog.confirmTitle')}
          message={t('snapshots.deleteConfirm')}
          danger
          confirmLabel={t('fixed.confirmDelete')}
          onConfirm={() => void performDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </DialogShell>
  );
}
