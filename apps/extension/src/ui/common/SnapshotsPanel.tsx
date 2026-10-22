import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { useTabStore } from '@/stores/tabStore';
import { useDataStore } from '@/stores/dataStore';
import { buildPartialSnapshot, snapshotDiff } from '@/core/snapshot/snapshotDiff';
import type { Snapshot } from '@/core/schema/models';
import { Button } from '@/ui/common/Button';
import { computeInsights } from '@/core/insights/tabInsights';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { ConfirmDialog, DialogShell } from '@/ui/dialog/Dialog';
import { EmptyState } from '@/ui/common/EmptyState';
import { RestoreConfirmDialog } from '@/ui/common/RestoreConfirmDialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { TextField } from '@/ui/common/TextField';
import { SnapshotRow } from '@/ui/common/SnapshotRow';

/** 习惯洞察区块的锚点 id：底栏洞察入口直达后滚动定位到这里。 */
const INSIGHTS_ANCHOR_ID = 'snapshots-insights';

/**
 * 快照面板：命名快照、归档中心与 OneTab / Workona 导入。
 * 把当前窗口存为命名快照/工作区，归档（关闭并保存），从 OneTab / Workona 导入，
 * 查看本地周报（统计 + 习惯洞察）；恢复走 platform/restoreSnapshot，提示走 undoStore。
 */
export interface SnapshotsPanelProps {
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
  /** 视图切换：initialView 由入口指定（洞察直达为 'report'，见 Props 注释）。 */
  const [view, setView] = useState<'list' | 'import' | 'report'>(initialView);
  /** 导入源切换：OneTab 文本 / Workona JSON。 */
  const [importSource, setImportSource] = useState<'onetab' | 'workona'>('onetab');
  const [importText, setImportText] = useState('');
  const [importName, setImportName] = useState('');
  /** 当前展开查看标签清单的快照 id（再次点击收起）。 */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 待删除确认的快照 id（快照是长期资产，删除不可撤销，必须二次确认）。 */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** 待恢复确认的快照 id：恢复会一次性新建整批标签，决策前必须看到影响面摘要。 */
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  /**
   * 待确认的**选择性恢复**：勾选集在点击那一刻固化为「部分快照」。
   * 勾选恢复与整份恢复是同一类破坏性动作（一次新建整批标签），不能绕过
   * 影响面闸门直接执行 —— 否则同一产品里同一动作出现两档安全级别。
   */
  const [confirmRestoreSelected, setConfirmRestoreSelected] = useState<Snapshot | null>(null);
  /** 正在恢复的快照 id：恢复会新建大量标签（耗时数百 ms），期间禁用该行按钮防双击并发。 */
  const [restoringId, setRestoringId] = useState<string | null>(null);
  /**
   * 勾选集：键为 `${index}-${tab.url}`（与 SnapshotRow 行键一致）。
   * 勾选是「从完整恢复里剔除若干条」，语义上必须**默认全选**——用户展开详情
   * 是为了取消某几条，而不是从零挑起。detailId 切换时重置为新快照的全选集。
   */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

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
  const groups = useMemo(
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
  const restoreInFlight = useRef(false);
  const deleteInFlight = useRef(false);

  const handleSave = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      await saveCurrentWindow(name.trim() || undefined);
      setName('');
      notify(t('已保存快照'));
    } catch {
      notifyError(t('操作失败，请稍后重试'));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const handleSaveSpace = async () => {
    try {
      // 不传名字：默认名由 store 统一持有（`DEFAULT_SNAPSHOT_NAMES.space`），
      // 与 useSpaces / App 的保存入口同口径。名字是落盘数据，不按界面语言生成，
      // 否则换语言后新旧工作区记录会变成两种名字。
      await saveSpace();
      notify(t('已保存快照'));
    } catch {
      notifyError(t('操作失败，请稍后重试'));
    }
  };

  const handleImport = async () => {
    try {
      if (importSource === 'workona') {
        const result = await importWorkona(importText);
        // 失败按原因分流（与备份导入 version-mismatch / invalid 同口径）：
        // 「文件拿错了」「文件不是 JSON」「JSON 不是 Workona 导出」三种失败
        // 统一表现为「导入 0 条」时，用户无从判断下一步该做什么。
        if (result.reason === 'too-large') {
          notify(t('文件太大（超过 1MB），请分成几份分别导入'));
          return;
        }
        if (result.reason === 'invalid-json') {
          notify(t('这不是合法的 JSON：文件可能被截断或损坏，请重新导出一次'));
          return;
        }
        if (result.reason === 'unrecognized') {
          notify(
            t('这段 JSON 不是 Workona 导出：顶层需要有 "Workspaces" 或 "Archived Workspaces" 字段')
          );
          return;
        }
        if (result.snapshots === 0) {
          // 结构合法但没产出快照：区分「没粘贴内容」与「识别到了但条目全不可恢复」。
          notify(
            importText.trim()
              ? result.skipped > 0
                ? t('识别到 {{count}} 个工作区，但其中没有可打开的网页地址', {
                    count: result.skipped
                  })
                : t('没找到网址：请粘贴 OneTab 导出的文本（每行一个网址），内容不超过 1MB')
              : t('该快照没有可恢复的标签')
          );
          return;
        }
        // `tabs` 是**落盘**标签数（parseWorkona 的 totalTabs 按最终保留的份重算），
        // 与下面「未导入」里的 truncatedTabs 不是一个分母：两句分别是「进了多少」
        // 和「丢了多少」，不能相加也不能互相折算。
        notify(
          t('已导入 {{snapshots}} 份快照（共 {{tabs}} 个标签）', {
            snapshots: result.snapshots,
            tabs: result.tabs
          })
        );
        // 截断必须显式告知：导入成功但静默少了一批标签/快照，是最难自查的一类问题。
        if (result.truncatedTabs > 0 || result.truncatedSnapshots > 0) {
          notify(
            t(
              '部分内容未导入：{{tabs}} 个标签、{{snapshots}} 份快照（超出存储上限，或不是 http/https 网址）',
              {
                tabs: result.truncatedTabs,
                snapshots: result.truncatedSnapshots
              }
            )
          );
        }
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
        notify(
          importText.trim()
            ? t(
                '没能解析出网址：请确认粘贴的是 OneTab 导出的文本（每行一个 http/https 网址），且内容不超过 1MB'
              )
            : t('该快照没有可恢复的标签')
        );
        return;
      }
      notify(t('已导入 {{count}} 个标签', { count }));
      setImportText('');
      setImportName('');
      setView('list');
    } catch {
      notifyError(t('操作失败，请稍后重试'));
    }
  };

  /** 行内「恢复」入口：先弹影响面确认（N 标签 + M 组），确认后才真正恢复。 */
  const requestRestore = (id: string, tabCount: number) => {
    if (tabCount === 0) {
      notify(t('该快照没有可恢复的标签'));
      return;
    }
    setConfirmRestoreId(id);
  };

  const handleRestore = async (id: string, tabCount: number) => {
    if (tabCount === 0) {
      notify(t('该快照没有可恢复的标签'));
      return;
    }
    // 互斥：恢复期间再点会基于同一窗口现状并发 create，可能把同一批标签开两份
    // （快照恢复没有 undo 栈式的 undoInFlight 互斥，这里在组件层补上）。
    if (restoreInFlight.current) return;
    restoreInFlight.current = true;
    setRestoringId(id);
    try {
      const { count, degraded } = await restore(id);
      notify(
        degraded
          ? t('已恢复 {{count}} 个标签；未能读取窗口现状，可能多开了已经打开着的页面', { count })
          : t('已恢复 {{count}} 个标签', { count })
      );
      onClose();
    } catch {
      notifyError(t('操作失败，请稍后重试'));
    } finally {
      restoreInFlight.current = false;
      setRestoringId(null);
    }
  };

  /**
   * 选择性恢复：按当前勾选集恢复，但**先弹影响面确认**（与整份恢复
   * 同一闸门）。勾选集为空提示用户先勾选；恢复互斥与 handleRestore 共用
   * restoringId（同一时刻只允许一个恢复在途）。
   */
  const handleRestoreSelected = (id: string, tabCount: number) => {
    if (tabCount === 0) {
      notify(t('请先勾选要恢复的条目'));
      return;
    }
    const snap = snapshots.find((entry) => entry.id === id);
    if (!snap) return;
    const selectedTabs = snap.tabs.filter((tab, index) => selectedKeys.has(`${index}-${tab.url}`));
    if (selectedTabs.length === 0) {
      notify(t('请先勾选要恢复的条目'));
      return;
    }
    setConfirmRestoreSelected(buildPartialSnapshot(snap, selectedTabs));
  };

  /** 确认后的选择性恢复执行体（勾选集已固化为传入的部分快照）。 */
  const performRestoreSelected = async (partial: Snapshot) => {
    setConfirmRestoreSelected(null);
    if (restoreInFlight.current) return;
    restoreInFlight.current = true;
    setRestoringId(partial.id);
    try {
      const { count, degraded } = await restoreSelected(partial.id, partial.tabs);
      notify(
        degraded
          ? t('已恢复 {{count}} 个标签；未能读取窗口现状，可能多开了已经打开着的页面', { count })
          : t('已恢复 {{count}} 个标签', { count })
      );
      onClose();
    } catch {
      notifyError(t('操作失败，请稍后重试'));
    } finally {
      restoreInFlight.current = false;
      setRestoringId(null);
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
    } catch {
      notifyError(t('操作失败，请稍后重试'));
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
    } catch {
      notifyError(t('操作失败，请稍后重试'));
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
        <div className="flex flex-col gap-2">
          {/* 源切换：OneTab 文本 / Workona JSON（迁移矩阵入口，互斥单选）。
              用 role=group + aria-pressed 而非 role=tablist/tab：后者要求配套的
              tabpanel / aria-controls / 方向键漫游 / roving tabindex，这里只实现了一半，
              读屏被承诺「选项卡」却按不出对应行为（工作区切换条 SpaceStrip 同口径）。 */}
          <div
            role="group"
            aria-label={t('选择导入源')}
            className="flex gap-1 self-start rounded-lg border border-gray-200 bg-gray-50 p-0.5"
          >
            <button
              type="button"
              aria-pressed={importSource === 'onetab'}
              // py-1.5：py-1 + 10px 字仅 23px，低于 24px 命中下限
              className={
                'chip chip--cjk rounded px-2 py-1.5 font-medium transition-base ' +
                (importSource === 'onetab'
                  ? 'bg-surface text-gray-800 elev-1'
                  : 'text-gray-500 hover:text-gray-700')
              }
              onClick={() => setImportSource('onetab')}
            >
              {t('从 OneTab 导入')}
            </button>
            <button
              type="button"
              aria-pressed={importSource === 'workona'}
              className={
                'chip chip--cjk rounded px-2 py-1.5 font-medium transition-base ' +
                (importSource === 'workona'
                  ? 'bg-surface text-gray-800 elev-1'
                  : 'text-gray-500 hover:text-gray-700')
              }
              onClick={() => setImportSource('workona')}
            >
              {t('从 Workona 导入')}
            </button>
          </div>
          <p className="text-3xs text-gray-500">
            {importSource === 'onetab'
              ? t('把 OneTab 导出的文本粘贴到这里，我们会解析其中的网址并保存为一个快照')
              : t(
                  '把 Workona 导出的 JSON 全文粘贴到这里：每个工作区会转换成一份快照（含归档工作区），仅导入 http/https 网址'
                )}
          </p>
          {importSource === 'onetab' && (
            <TextField
              size="sm"
              placeholder={t('为这个快照起个名字（可留空）')}
              ariaLabel={t('为这个快照起个名字（可留空）')}
              value={importName}
              onChange={setImportName}
            />
          )}
          <TextField
            multiline
            className="h-40"
            placeholder={
              importSource === 'onetab'
                ? t('https://example.com - 网页标题')
                : t('{ "Workspaces": [ … ] }')
            }
            ariaLabel={t('导入')}
            value={importText}
            onChange={setImportText}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded min-h-6 px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('list')}
            >
              {t('取消')}
            </button>
            {/* 改走 Button：手写版少了 disabled:* 全族，且字号/圆角与其余按钮
                不在同一套刻度上。 */}
            <Button variant="primary" size="xs" onClick={() => void handleImport()}>
              {t('导入')}
            </Button>
          </div>
        </div>
      ) : view === 'report' ? (
        <div className="flex flex-col gap-3">
          <p className="text-3xs text-gray-600">{t('本地聚合，不涉及任何网络或账号')}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-base font-semibold text-gray-800">{weekSnapCount}</p>
              {/* 这个数字**已包含**下面「归档」「工作区」两类（同一批数据的三种切片），
                  并排会让人误以为三者相加才是总数，故标签必须点明「总数」语义。 */}
              <p className="text-3xs text-gray-500">{t('本周快照总数（含下面两类）')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekArchives}</p>
              <p className="text-3xs text-gray-500">{t('归档')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekSpaces}</p>
              <p className="text-3xs text-gray-500">{t('工作区')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-surface px-3 py-2">
              <p className="text-lg font-semibold text-gray-800">{weekTabs}</p>
              <p className="text-3xs text-gray-500">{t('累计归档标签')}</p>
            </div>
          </div>
          {/* 习惯洞察：从当前窗口实时推导行动建议，全部本地计算。
              出口指向已有动作（清理重复 / 一键休眠 / 归档窗口），形成闭环。 */}
          <div
            id={INSIGHTS_ANCHOR_ID}
            tabIndex={-1}
            className="flex flex-col gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2.5"
          >
            <p className="text-2xs font-semibold text-accent-700">{t('习惯洞察')}</p>
            <p className="text-3xs leading-relaxed text-accent-700/90">
              {t('全部本地计算，零上报——从当前窗口实时推导的行动建议')}
            </p>
            {insights.duplicateHotspots.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-3xs font-medium text-gray-600">{t('重复重灾区')}</p>
                {insights.duplicateHotspots.map((hotspot) => (
                  <p key={hotspot.host} className="text-3xs text-gray-600">
                    <span className="font-medium text-gray-800">{hotspot.host}</span>
                    {' · '}
                    {t('{{count}} 个重复标签', { count: hotspot.count })}
                  </p>
                ))}
                <button
                  type="button"
                  /* min-h-6：py-0.5 + 11px 字仅约 20.5px，低于 24px 命中下限 */
                  className="chip chip--cjk min-h-6 self-start rounded px-2 py-1 font-medium text-accent-700 transition-base hover:bg-accent-100"
                  onClick={onCleanDuplicates}
                >
                  {t('清理重复标签')}
                </button>
              </div>
            )}
            {insights.discardableCount > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-3xs font-medium text-gray-600">{t('休眠候选')}</p>
                <p className="text-3xs text-gray-600">
                  {t('{{count}} 个标签可安全休眠（已休眠 {{discarded}} 个）', {
                    count: insights.discardableCount,
                    discarded: insights.discardedCount
                  })}
                </p>
                <button
                  type="button"
                  /* min-h-6：py-0.5 + 11px 字仅约 20.5px，低于 24px 命中下限 */
                  className="chip chip--cjk min-h-6 self-start rounded px-2 py-1 font-medium text-accent-700 transition-base hover:bg-accent-100"
                  onClick={onDiscardInactive}
                >
                  {t('一键休眠')}
                </button>
              </div>
            )}
            {insights.staleTabs.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-3xs font-medium text-gray-600">
                  {t('滞留预警（超过 7 天未激活）')}
                </p>
                {insights.staleTabs.map((stale) => (
                  <p key={stale.id} className="text-3xs text-gray-600">
                    <span className="font-medium text-gray-800">{stale.label}</span>
                    {' · '}
                    {t('已滞留 {{days}} 天', { days: stale.days })}
                  </p>
                ))}
                <button
                  type="button"
                  /* min-h-6：py-0.5 + 11px 字仅约 20.5px，低于 24px 命中下限 */
                  className="chip chip--cjk min-h-6 self-start rounded px-2 py-1 font-medium text-accent-700 transition-base hover:bg-accent-100"
                  onClick={onArchiveWindow}
                >
                  {t('归档当前窗口')}
                </button>
              </div>
            )}
            {insights.duplicateHotspots.length === 0 &&
              insights.discardableCount === 0 &&
              insights.staleTabs.length === 0 && (
                <p className="text-3xs text-gray-600">
                  {t('窗口状态很健康：没有重复、无需休眠、也没有滞留标签')}
                </p>
              )}
          </div>
          <button
            type="button"
            className="self-start rounded min-h-6 px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
            onClick={() => setView('list')}
          >
            {t('取消')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {!saving ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-accent-300 bg-accent-50 px-3 py-2 text-sm font-medium text-accent-700 transition-base hover:bg-accent-100"
                title={t('把当前窗口的标签存为一份快照，随时可整体恢复；不会出现在顶部切换条')}
                onClick={() => setSaving(true)}
              >
                <Icon d={Icons.snapshot} className="h-4 w-4" />
                {t('保存当前窗口为快照')}
              </button>
              <button
                type="button"
                title={t(
                  '把当前窗口存为一份「工作区」快照，可在顶部切换条一键切换；切走前会先保存当前窗口。每次保存都新增一条，不覆盖旧版'
                )}
                className="flex items-center justify-center gap-2 rounded-lg border border-control bg-surface px-3 py-2 text-sm font-medium text-gray-600 transition-base hover:bg-gray-50"
                onClick={() => void handleSaveSpace()}
              >
                <Icon d={Icons.layers} className="h-4 w-4" />
                {t('保存为工作区')}
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
                placeholder={t('为这个快照起个名字（可留空）')}
                aria-label={t('为这个快照起个名字（可留空）')}
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
              <Button variant="primary" size="xs" onClick={() => void handleSave()}>
                {t('保存')}
              </Button>
              <button
                type="button"
                className="rounded min-h-6 px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
                onClick={() => {
                  setSaving(false);
                  setName('');
                }}
              >
                {t('取消')}
              </button>
            </div>
          )}

          {/* 不再自套 max-h + overflow：DialogShell 的内容区已是 flex-1 overflow-y-auto、
              外壳 max-h-[85vh]，再嵌一层会出现两条滚动条且高度互相打架
              （UndoHistoryPanel 已按此约定实现）。pr-1 也去掉 —— 内容区 px-4 之外
              再多 4px 会让列表右边缘比标题栏 × 少 4px。 */}
          <div className="flex flex-col gap-2">
            {ordered.length === 0 ? (
              /* 复用通用空态：与面板其余空态同款（图标 + 说明），手写会出现三处三种观感。 */
              <EmptyState
                icon={<Icon d={Icons.snapshot} className="h-4 w-4" />}
                title={t('还没有快照。误关窗口后会自动保存，也可以随时手动保存当前窗口。')}
              />
            ) : (
              groups.map((group) => (
                <div key={group.key}>
                  <h3 className="mb-1 flex items-baseline gap-1 text-3xs font-medium tracking-wide text-gray-500">
                    {group.title}
                    <span className="text-gray-500">
                      {t('{{count}} 份', { count: group.items.length })}
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
                        onRestore={requestRestore}
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
              className="flex-1 rounded min-h-6 px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('import')}
            >
              {t('从 OneTab 导入')}
            </button>
            <button
              type="button"
              className="flex-1 rounded min-h-6 px-2 py-1 text-2xs text-gray-500 hover:bg-gray-100"
              onClick={() => setView('report')}
            >
              {t('本周周报')}
            </button>
          </div>
        </div>
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
          const snap = snapshots.find((entry) => entry.id === confirmRestoreId);
          if (!snap) return null;
          return (
            <RestoreConfirmDialog
              snapshot={snap}
              onConfirm={() => {
                setConfirmRestoreId(null);
                void handleRestore(snap.id, snap.tabCount);
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
