import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { computeInsights } from '@/core/insights/tabInsights';
import { snapshotDiff } from '@/core/snapshot/snapshotDiff';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { DAY_MS } from '@/core/util/time';
import { useDataStore } from '@/stores/dataStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useTabStore } from '@/stores/tabStore';
import { useUndoStore } from '@/stores/undoStore';
import { ConfirmDialog, DialogShell } from '@/ui/dialog/Dialog';
import { RestoreConfirmDialog } from '@/ui/snapshot/RestoreConfirmDialog';
import { SnapshotImportView } from '@/ui/snapshot/SnapshotImportView';
import { SnapshotListView, type SnapshotGroup } from '@/ui/snapshot/SnapshotListView';
import { INSIGHTS_ANCHOR_ID, SnapshotReportView } from '@/ui/snapshot/SnapshotReportView';
import { useSnapshotImport } from '@/ui/snapshot/useSnapshotImport';
import { useSnapshotRestore } from '@/ui/snapshot/useSnapshotRestore';

/**
 * 快照面板：命名快照、归档中心与 OneTab / Workona 导入。
 * 把当前窗口存为命名快照/工作区，归档（关闭并保存），从 OneTab / Workona 导入，
 * 查看本地周报（统计 + 习惯洞察）；恢复走 platform/restoreSnapshot，提示走 undoStore。
 *
 * 本文件只保留**编排**：状态、写路径 handler 与三个确认闸门。三个视图分别在
 * `SnapshotListView` / `SnapshotImportView` / `SnapshotReportView`，共用按钮在
 * `snapshotButtons` —— 原 699 行里三者互相挤占，改一条文案要在三段 JSX 间翻找。
 */
interface SnapshotsPanelProps {
  onClose: () => void;
  /**
   * 初始视图：默认 'list'（快照列表）。
   * 习惯洞察入口传 'report' —— 洞察埋在周报页签里需「打开面板 → 切页签」
   * 两步才可见；从底栏徽章直达时直接落在洞察所在的周报视图。
   */
  initialView?: 'list' | 'import' | 'report';
  /** 习惯洞察行动出口：由 App 注入既有 handler，面板内不重复实现。 */
  onCleanDuplicates: () => void;
  /** 一键休眠全部后台标签（洞察「休眠候选」出口）。 */
  onDiscardInactive: () => void;
  /** 归档当前窗口（洞察「滞留预警」出口）。 */
  onArchiveWindow: () => void;
}

export function SnapshotsPanel({
  onClose,
  initialView = 'list',
  onCleanDuplicates,
  onDiscardInactive,
  onArchiveWindow
}: SnapshotsPanelProps) {
  const { t } = useTranslation();
  const snapshots = useSnapshotStore((state) => state.snapshots);
  const saveCurrentWindow = useSnapshotStore((state) => state.saveCurrentWindow);
  const saveSpace = useSnapshotStore((state) => state.saveSpace);
  const deleteSnapshot = useSnapshotStore((state) => state.deleteSnapshot);
  const renameSnapshot = useSnapshotStore((state) => state.renameSnapshot);
  const notify = useUndoStore((state) => state.notify);
  const notifyError = useUndoStore((state) => state.notifyError);
  const notifyFailure = useUndoStore((state) => state.notifyFailure);

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  /** 视图切换：initialView 由入口指定（洞察直达为 'report'，见 Props 注释）。 */
  const [view, setView] = useState<'list' | 'import' | 'report'>(initialView);
  /** 导入子流程（表单态 + 失败分流）抽在 useSnapshotImport，面板只装配。 */
  const {
    source: importSource,
    text: importText,
    name: importName,
    setSource: setImportSource,
    setText: setImportText,
    setName: setImportName,
    runImport: handleImport
  } = useSnapshotImport({
    t,
    notify,
    notifyFailure,
    onDone: () => setView('list')
  });
  /** 当前展开查看标签清单的快照 id（再次点击收起）。 */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 待删除确认的快照 id（快照是长期资产，删除不可撤销，必须二次确认）。 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /**
   * 勾选集：键为 `${index}-${tab.url}`（与 SnapshotRow 行键一致）。
   * 勾选是「从完整恢复里剔除若干条」，语义上必须**默认全选**——用户展开详情
   * 是为了取消某几条，而不是从零挑起。detailId 切换时重置为新快照的全选集。
   */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  /**
   * 恢复链路（在途互斥 + 两道影响面确认 + 执行体）抽在 useSnapshotRestore。
   * 它依赖勾选集，故必须在 selectedKeys 之后调用。
   */
  const {
    restoringId,
    confirmRestoreId,
    setConfirmRestoreId,
    confirmRestoreSelected,
    setConfirmRestoreSelected,
    requestRestore,
    runRestore: handleRestore,
    requestRestoreSelected: handleRestoreSelected,
    runRestoreSelected: performRestoreSelected
  } = useSnapshotRestore({
    t,
    snapshots,
    selectedKeys,
    notify,
    notifyFailure,
    onClose
  });

  const ordered = useMemo(
    () => [...snapshots].sort((a, b) => b.createdAt - a.createdAt),
    [snapshots]
  );

  /**
   * 响应式订阅：窗口标签与绑定标签 id（恢复预览与习惯洞察共用）。
   * 窗口标签必须经订阅而非 getState 获取——面板打开期间窗口可能变化，
   * tab 变化触发重渲染并刷新 detailDiff 的 memo 缓存，保证预览始终基于「此刻的窗口」。
   */
  const tabs = useTabStore((state) => state.tabs);
  const boundTabIds = useDataStore((state) => state.boundTabIds);

  /**
   * 展开行的恢复预览 diff：以当前窗口已打开 URL 键集合为基准，
   * 三分类（将新建 / 已存在 / 不恢复）让「恢复会带来什么」决策前可见。
   * 依赖数组显式含 tabs：标签变化即缓存失效重算，用 getState 取值会让
   * 窗口变化后预览 diff 停留在旧值（窗口标签量级 < 500，开销可忽略）。
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

  /** 勾选切换：勾选集不可变更新，避免行内共享引用导致勾选不刷新。 */
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
   * 命名快照（手动 + 工作区）/ 归档 / 关窗自动保存。
   *
   * 四种 origin 混排在一个列表里、只靠徽标区分时，用户无法判断
   * 「这个对象是持续更新的、已经关闭标签的、还是系统自动兜底的」。
   * 分组后每组语义唯一，恢复预期才能对齐。
   */
  const groups: SnapshotGroup[] = useMemo(
    () =>
      [
        {
          key: 'named' as const,
          title: t('命名快照'),
          desc: t('手动保存的窗口，长期留存，恢复时重新打开标签（含按主题归类的工作区）'),
          items: ordered.filter((snap) => snap.origin === 'manual' || snap.origin === 'space')
        },
        {
          key: 'archive' as const,
          title: t('归档（关闭并保存）'),
          desc: t('关闭窗口时自动留存，原标签已关闭，可随时完整恢复'),
          items: ordered.filter((snap) => snap.origin === 'archive')
        },
        {
          key: 'auto' as const,
          title: t('关窗自动保存'),
          desc: t('窗口意外关闭的兜底快照，系统自动留存'),
          items: ordered.filter((snap) => snap.origin === 'auto')
        }
      ].filter((group) => group.items.length > 0),
    [ordered, t]
  );

  /** 保存进行中标尺：await 期间输入框仍在，Enter 连击/双击会并发提交出重复快照。 */
  const saveInFlight = useRef(false);
  /**
   * 恢复/删除互斥必须走 ref：restoringId 是渲染期 state，同一 tick 内的连点
   * 读到的都是旧值 null（disabled 也要等重渲染才生效），会双双穿透 —— 表现为
   * 同一份快照被开两批标签，或同 id 的删除并发双写。
   * restoringId 只保留为展示态（哪一行在进行中）。
   */
  const deleteInFlight = useRef(false);
  /**
   * 保存工作区在途标尺（与 saveInFlight 同款）：`saveSpace` 是唯一没有互斥的写
   * 路径，双击会并发创建两份工作区快照（每次保存都新增一条，不覆盖）。
   * `savingSpace` 只承担按钮禁用态（渲染期可读），同 tick 内的连点靠 ref 拦。
   */
  const saveSpaceInFlight = useRef(false);
  const [savingSpace, setSavingSpace] = useState(false);

  const handleSave = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      // saveCurrentWindow 返回 false 表示「现场没有可保存的标签」（如只剩
      // chrome:// 页），此时 store 已给出可见回执，这里不能再补一条「已保存快照」
      // ——两条互相矛盾的提示同时出现，用户无法判断到底存没存。
      const saved = await saveCurrentWindow(name.trim() || undefined);
      if (!saved) return;
      setName('');
      notify(t('已保存快照'));
    } catch (error) {
      // 走 notifyFailure：保存/导入/恢复/删除/重命名都是写路径，失败必须进诊断
      // 导出，否则「点了没反应」在用户与开发者两侧都无从定位。
      notifyFailure('snapshots', t('操作失败，请稍后重试'), error);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const handleSaveSpace = async () => {
    if (saveSpaceInFlight.current) return;
    saveSpaceInFlight.current = true;
    setSavingSpace(true);
    try {
      // 不传名字：默认名由 store 统一持有（`DEFAULT_SNAPSHOT_NAMES.space`），
      // 与 useSpaces / App 的保存入口同口径。名字是落盘数据，不按界面语言生成，
      // 否则换语言后新旧工作区记录会变成两种名字。
      const saved = await saveSpace();
      if (!saved) return;
      notify(t('已保存快照'));
    } catch (error) {
      notifyFailure('snapshots', t('操作失败，请稍后重试'), error);
    } finally {
      saveSpaceInFlight.current = false;
      setSavingSpace(false);
    }
  };

  const performDelete = async (id: string) => {
    setConfirmDeleteId(null);
    // 互斥：确认弹窗按钮快速连点会并发触发两次 deleteSnapshot（同 id 双写竞态）。
    // 与 handleRestore / handleSave 同一口径（ref 标尺而非渲染期 state）。
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    try {
      await deleteSnapshot(id);
    } catch (error) {
      notifyFailure('snapshots', t('操作失败，请稍后重试'), error);
    } finally {
      deleteInFlight.current = false;
    }
  };

  const beginRename = (id: string, current: string) => {
    setEditingId(id);
    setEditingName(current);
  };
  const commitRename = async () => {
    if (!editingId) return;
    // 空名在 store 层会被丢弃（快照名是列表里的唯一可读标识，空名没有意义），
    // 入口侧必须先拦住并说明：否则用户改名后点保存，编辑框静默退回旧名，
    // 与「保存失败」无从区分。拦下时**保留**编辑态，用户可以接着输入。
    if (editingName.trim() === '') {
      notifyError(t('快照名不能为空'));
      return;
    }
    try {
      await renameSnapshot(editingId, editingName);
    } catch (error) {
      notifyFailure('snapshots', t('操作失败，请稍后重试'), error);
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

  const weekStart = Date.now() - 7 * DAY_MS;
  const weekSnaps = snapshots.filter((s) => s.createdAt >= weekStart);
  const weekArchives = weekSnaps.filter((s) => s.origin === 'archive').length;
  const weekSpaces = weekSnaps.filter((s) => s.origin === 'space').length;
  const weekSnapCount = weekSnaps.length;
  const weekTabs = weekSnaps.reduce((sum, s) => sum + s.tabCount, 0);

  /**
   * 习惯洞察：当前窗口实时计算。tabs / boundTabIds 已在上方订阅，
   * 洞察对象是「此刻的窗口」，面板打开期间标签关闭/打开都应反映。
   * 周报统计块与洞察块共用一次 useMemo 各自独立，互不干扰重算。
   */
  const insights = useMemo(() => computeInsights(tabs, new Set(boundTabIds)), [tabs, boundTabIds]);

  /**
   * 洞察直达：从底栏入口进来时（initialView='report'）把洞察区块滚入视野。
   * 周报统计在其上方，不滚动的话用户仍可能看到的是统计而非洞察 —— 直达要落到
   * 真正想看的东西。只在首次进入 report 视图时做一次，之后用户手动切页签不再干预。
   */
  const insightsFocusedRef = useRef(false);
  useEffect(() => {
    if (initialView !== 'report' || insightsFocusedRef.current) return;
    if (view !== 'report') return;
    insightsFocusedRef.current = true;
    const anchor = document.getElementById(INSIGHTS_ANCHOR_ID);
    anchor?.scrollIntoView({ block: 'start' });
  }, [initialView, view]);

  return (
    // 面板内还有周报、习惯洞察、OneTab/Workona 导入；底栏「洞察」按钮也落进
    // 这里。标题只写「快照」时，点进来看到的东西与预期不符，而另一个入口
    // （洞察）指向同一容器却叫别的名字。
    <DialogShell title={t('快照与洞察')} onClose={onClose} widthClassName="dialog-md">
      {view === 'import' ? (
        <SnapshotImportView
          source={importSource}
          onSourceChange={setImportSource}
          name={importName}
          onNameChange={setImportName}
          text={importText}
          onTextChange={setImportText}
          onCancel={() => setView('list')}
          onImport={() => void handleImport()}
        />
      ) : view === 'report' ? (
        <SnapshotReportView
          stats={{
            snapCount: weekSnapCount,
            archives: weekArchives,
            spaces: weekSpaces,
            tabs: weekTabs
          }}
          insights={insights}
          onCleanDuplicates={onCleanDuplicates}
          onDiscardInactive={onDiscardInactive}
          onArchiveWindow={onArchiveWindow}
          onBack={() => setView('list')}
        />
      ) : (
        <SnapshotListView
          ordered={ordered}
          groups={groups}
          saving={saving}
          onStartSaving={() => setSaving(true)}
          name={name}
          onNameChange={setName}
          onSave={() => void handleSave()}
          onCancelSaving={() => {
            setSaving(false);
            setName('');
          }}
          savingSpace={savingSpace}
          onSaveSpace={() => void handleSaveSpace()}
          editingId={editingId}
          editingName={editingName}
          onEditingNameChange={setEditingName}
          onBeginRename={beginRename}
          onCommitRename={() => void commitRename()}
          onCancelRename={() => {
            setEditingId(null);
            setEditingName('');
          }}
          detailId={detailId}
          onToggleDetail={toggleDetail}
          detailDiff={detailDiff}
          selectedKeys={selectedKeys}
          onToggleSelected={toggleSelected}
          onRestoreSelected={handleRestoreSelected}
          restoringId={restoringId}
          onRequestRestore={requestRestore}
          onDelete={handleDelete}
          onOpenImport={() => setView('import')}
          onOpenReport={() => setView('report')}
        />
      )}
      {confirmDeleteId !== null && (
        <ConfirmDialog
          title={t('确认操作')}
          message={t('删除这份快照？删除后无法恢复')}
          danger
          confirmLabel={t('确认删除')}
          onConfirm={() => void performDelete(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
      {confirmRestoreId !== null &&
        (() => {
          const snap: Snapshot | undefined = snapshots.find(
            (entry) => entry.id === confirmRestoreId
          );
          if (!snap) return null;
          return (
            <RestoreConfirmDialog
              snapshot={snap}
              onConfirm={() => {
                setConfirmRestoreId(null);
                void handleRestore(snap.id);
              }}
              onCancel={() => setConfirmRestoreId(null)}
            />
          );
        })()}
      {/* 选择性恢复的影响面闸门：与整份恢复共用同一组件（勾选数即影响面）。 */}
      {confirmRestoreSelected !== null && (
        <RestoreConfirmDialog
          snapshot={confirmRestoreSelected}
          onConfirm={() => void performRestoreSelected(confirmRestoreSelected)}
          onCancel={() => setConfirmRestoreSelected(null)}
        />
      )}
    </DialogShell>
  );
}
