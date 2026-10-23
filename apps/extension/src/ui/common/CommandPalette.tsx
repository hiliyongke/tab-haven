import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/i18n';
import type { LucideIcon } from 'lucide-react';
import type { FixedFolder, Snapshot } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { RestoreConfirmDialog } from '@/ui/common/RestoreConfirmDialog';
import { SearchEngine } from '@/core/search/SearchEngine';
import { hostnameOf } from '@/core/url/UrlInspector';
import { useDataStore } from '@/stores/dataStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { Icon, Icons } from '@/ui/common/Icon';
import { IconButton } from '@/ui/common/IconButton';
import { Favicon } from '@/ui/common/Favicon';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { useModalA11y } from '@/ui/dialog/Dialog';
import { usePinyinDictionary } from '@/ui/search/usePinyinDictionary';

/** 命令面板的动作回调集合（由 sidepanel App 注入，复用既有 handler）。 */
export interface PaletteActions {
  onDiscardInactive: () => void;
  onWakeAll: () => void;
  onQuickRegroup: () => void;
  /** 一键清理重复标签（每网址保留「最近访问 > 激活 > 固定 > 位置靠前 > id 大」者，可撤销）。 */
  onCleanDuplicates: () => void;
  onLocateActive: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  /** 导出备份：命令面板也要能直达，不能只埋在设置页。 */
  onExportData: () => void;
  /** 打开关于页（能力总览 + 信任面板）：隐私自证的直达入口。 */
  onOpenAbout: () => void;
  onToggleAllSections: () => void;
  onSwitchTab: (tabId: number) => void;
  onOpenSnapshots: () => void;
  onSaveSnapshot: () => void;
  onArchiveWindow: () => void;
  onSaveSpace: () => void;
  /** 打开指定固定文件夹的全部条目（文件夹即「空间」：一键打开整组收藏）。 */
  onOpenFolder: (folderId: string) => void;
  /**
   * 把当前激活标签存入指定文件夹。
   *
   * 面板内必须有一条「非拖拽」的归档入口：把标签存进文件夹若只能靠一次精确
   * 拖放，键盘用户、触控板用户、窄面板用户就被完全排除（浏览器右键菜单有
   * 「加入文件夹」，侧边栏内却没有，能力割裂）。命令面板是这里唯一的补齐路径。
   */
  onSaveTabToFolder: (folderId: string) => void;
  /** 切换到已有工作区：已存的工作区必须能在面板里搜到。 */
  onSwitchSpace: (spaceId: string) => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /**
   * 命令区内的分组（仅在「命令」段渲染组标题）。
   *
   * 命令按语义分组：平铺混排会让休眠类 / 记录类 / 导航类交错，每次 ⌘P 都要
   * 扫过全部才能找到「设置」。分组后扫读成本降到「3 个组标题 + 组内少量」。
   */
  groupKey?: string;
  /**
   * 标签项携带网址（不是图标地址）：图标由浏览器按页面 URL 现取，失败回退首字母，
   * 扫读效率远高于统一放大镜。
   */
  url?: string;
  /** 是否为当前激活标签（显示「当前」标记并置顶）。 */
  current?: boolean;
  /** 可选说明行：破坏性操作（如重排分组）需要在这里讲清影响面。 */
  hint?: string;
  /**
   * 执行命令。
   *
   * 返回 `false` 表示「本命令需要留在面板里继续交互」，调用方不得关闭面板：
   * 快照恢复要先弹影响面确认，而确认框是本面板的子树——面板一卸载，待确认的
   * 快照与确认框同时消失，入口等于静默失效（既不恢复也不提示）。
   * 其余命令返回 `undefined`，关闭行为不变。
   */
  run: () => void | boolean;
}

/** 空查询时标签项的挂载上限（含 Favicon 的行有真实渲染成本；输入后过滤路径不受限）。 */
const EMPTY_QUERY_TAB_LIMIT = 20;
/** dashboard 里「最近关闭批次」与「最近快照」各展示的条数。 */
const DASHBOARD_RECENT_LIMIT = 3;

/**
 * 命令区内的分组（仅在命令段渲染组标题）：扫读时组标题把 14 条平铺命令切成
 * 3 组，找「设置」不必再扫过全部。
 *
 * 值是**分组标识而不是文案**：写中文原文时它落在对象值位置，扫描器抽不到
 * （与 ORIGIN_BADGE_LABELS 同一个坑），英文模式会残留汉字。文案在渲染处用
 * 字面量 `t()` 调用点输出。
 */
type CommandGroup = 'organize' | 'record' | 'open';

const COMMAND_GROUPS: Record<string, CommandGroup> = {
  discard: 'organize',
  wake: 'organize',
  regroup: 'organize',
  cleanDuplicates: 'organize',
  locate: 'organize',
  history: 'record',
  snapshots: 'record',
  saveSnapshot: 'record',
  saveSpace: 'record',
  archive: 'record',
  export: 'record',
  settings: 'open',
  about: 'open'
};
/** 未在表中的命令（动态命令等）归到 open，避免出现无组标题的孤儿项。 */
function commandGroupOf(id: string | undefined): CommandGroup | '' {
  if (id === undefined) return '';
  return COMMAND_GROUPS[id] ?? 'open';
}
/** 分组标识 → 中文原文（字面量调用点，扫描器据此抽词）。 */
function commandGroupLabel(group: CommandGroup | '', t: (key: string) => string): string {
  if (group === 'organize') return t('整理');
  if (group === 'record') return t('记录');
  return t('打开');
}

/** listbox 内的单个选项（命令 / 标签通用）：图标（favicon 优先）+ 截断标签 + 选中态。 */
function PaletteOption({
  cmd,
  selected,
  onSelect,
  onRun
}: {
  cmd: CommandItem;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      id={`palette-item-${cmd.id}`}
      role="option"
      aria-selected={selected}
      // role=option 是交互角色，宿主必须可聚焦；tabIndex=-1 使其可程序化
      // 聚焦（DOM 焦点始终留在 combobox 输入框，靠 aria-activedescendant 漫游）。
      tabIndex={-1}
      className={
        /* transition-colors：↑↓ 漫游时的选中底色不得硬切，否则是面板里唯一没有过渡的交互元素 */
        'flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm outline-none transition-colors ' +
        (selected ? 'bg-accent-50 text-accent-700' : 'text-gray-700 hover:bg-gray-50')
      }
      onMouseEnter={onSelect}
      onClick={onRun}
    >
      {cmd.url ? (
        <span className="flex shrink-0 items-center">
          <Favicon pageUrl={cmd.url} title={cmd.label} size={16} />
        </span>
      ) : (
        <Icon d={cmd.icon} className="h-4 w-4 shrink-0 opacity-70" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{cmd.label}</span>
        {/* 字号走 text-3xs：项目纪律「正文说明 ≥ 11px」（text-2xs 仅限图标内文/徽角），
            由 design-tokens 守卫强制。 */}
        {cmd.hint && (
          <span className="block truncate text-3xs leading-snug text-gray-500">{cmd.hint}</span>
        )}
      </span>
      {/* py-px + leading-none：徽章高度由显式行高决定，不再随继承行高浮动。 */}
      {cmd.current && (
        <span className="chip chip--cjk shrink-0 rounded bg-accent-100 px-1 py-px text-accent-700">
          {t('当前')}
        </span>
      )}
    </div>
  );
}

/**
 * 命令面板：⌘P / Ctrl+P 唤起，可搜可执行。
 * 既能跑动作命令（休眠/整理/定位/设置…），也能「切换到标签」，
 * 把 ⌘K 的搜索能力升级为完整 Spotlight 式入口。纯交互增益、零隐私成本。
 */
export function CommandPalette({
  tabs,
  folders,
  actions,
  onClose
}: {
  tabs: readonly TabRecord[];
  /** 固定文件夹列表：每个文件夹生成一个「打开全部条目」命令。 */
  folders: readonly FixedFolder[];
  actions: PaletteActions;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  /** listbox 的稳定 id：aria-controls / aria-activedescendant 的组合依赖它。 */
  const listId = useId();
  const listScrollRef = useRef<HTMLDivElement>(null);
  useScrollFade(listScrollRef);
  // 与弹窗族统一的行为契约：焦点陷阱 + 关闭后焦点恢复。
  // Esc 由 <dialog> 的 cancel 事件接管（原生模态语义），故此处不再重复处理。
  useModalA11y(panelRef, onClose);

  // 原生 <dialog> 默认 hidden，必须显式 showModal() 才会显示并进入真正的模态
  // （背景自动 inert、Esc 触发 cancel）。用 showModal 而非 open 属性，
  // 后者是非模态的，背景内容仍可被 Tab 聚焦。
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!panel.open) panel.showModal();
    return () => {
      if (panel.open) panel.close();
    };
  }, []);

  // 标签项过滤与 SearchBar 同一内核（标题/URL/拼音首字母/全拼模糊匹配）——
  // 用裸 includes 时中文标题输拼音首字母命中不了，会与 SearchBar 形成两套搜索口径。
  // 命令（i18n 固定文案）与文件夹保持子串过滤。
  const pinyinSearch = useDataStore((state) => state.settings.pinyinSearch);
  // 拼音是引擎的构造入参（引擎构造后不可变）：词典就绪后本信号翻转，
  // 两个引擎随之重建，命中自然纳入拼音——不需要「失效计数器」这类外部触发器。
  const pinyinUsable = usePinyinDictionary(pinyinSearch);
  const engine = useMemo(
    () =>
      new SearchEngine(
        tabs.map((tab) => ({
          id: tab.id,
          title: tab.title ?? '',
          url: tab.url ?? '',
          active: tab.active
        })),
        { pinyin: pinyinUsable }
      ),
    [tabs, pinyinUsable]
  );
  // 文件夹名同样走拼音内核（用户命名内容与标签同口径）；id 用数组下标合成。
  const folderEngine = useMemo(
    () =>
      new SearchEngine(
        folders.map((folder, index) => ({
          id: index,
          title: folder.name,
          url: '',
          active: false
        })),
        { pinyin: pinyinUsable }
      ),
    [folders, pinyinUsable]
  );

  // 空查询 dashboard 数据源（栈尾为最新批次；快照按时间降序取前 3）。
  const undoBatches = useUndoStore((state) => state.batches);
  const snapshots = useSnapshotStore((state) => state.snapshots);
  /** 待确认恢复的快照（恢复影响面闸门，与快照面板共用同一组件）。 */
  const [pendingRestore, setPendingRestore] = useState<Snapshot | null>(null);

  // 命令与标签分组：键盘漫游顺序保持「文件夹 → 命令 → 最近 → 标签」不变，
  // 仅在视觉上插入分组标题，让混排的数十项结果可按类别扫读。
  // 文件夹命令：每个固定文件夹一个「打开全部条目」命令，键入文件夹名直达。
  const { folderItems, commandItems, recentItems, tabItems, tabTruncated } = useMemo(() => {
    // 文件夹组只放「打开」（读）。写入命令（把当前标签存进去）刻意放在后面的
    // 命令组：两者 label 都含文件夹名，同组时会与「打开」争夺首位 —— 用户搜
    // 文件夹名按 Enter 期望打开，却会执行「把当前标签存进去」这个写操作。
    const folderCmds: CommandItem[] = folders.map((folder) => ({
      id: `folder-${folder.id}`,
      label: folder.name,
      icon: Icons.folder,
      hint: t('打开该文件夹的全部 {{count}} 个条目', { count: folder.items.length }),
      run: () => actions.onOpenFolder(folder.id)
    }));
    // 归档的写入命令：拖拽不能是唯一路径，否则键盘与触屏用户无处可走。
    const saveCmds: CommandItem[] = folders.map((folder) => ({
      id: `save-tab-folder-${folder.id}`,
      label: t('把当前标签存到「{{name}}」', { name: folder.name }),
      icon: Icons.folderPlus,
      run: () => actions.onSaveTabToFolder(folder.id)
    }));
    // 已存的工作区不能只靠顶部 chip 条触达（64px 封顶内滚，第 9 个已不可见）：
    // 一级导航概念必须有全局入口。
    const spaceCmds: CommandItem[] = snapshots
      .filter((snapshot) => snapshot.origin === 'space')
      .map((space) => ({
        id: `space-${space.id}`,
        label: t('切换到「{{name}}」', { name: space.name }),
        icon: Icons.layers,
        hint: t('共 {{count}} 个标签', { count: space.tabCount }),
        run: () => actions.onSwitchSpace(space.id)
      }));
    const base: CommandItem[] = [
      {
        id: 'discard',
        label: t('休眠全部后台标签（释放内存）'),
        icon: Icons.snowflake,
        run: actions.onDiscardInactive
      },
      {
        id: 'wake',
        label: t('全部唤醒'),
        icon: Icons.wakeAll,
        // 口径明示：两条唤醒路径覆盖的窗口范围不同（这条只看当前窗口，
        // 自动休眠的「全部唤醒」按台账 tabIds，可能跨窗口）。
        hint: t('只唤醒当前窗口的休眠标签；其他窗口的休眠标签请从自动休眠提示里点「全部唤醒」'),
        run: actions.onWakeAll
      },
      {
        id: 'regroup',
        label: t('重排临时区分组'),
        icon: Icons.quickRegroup,
        hint: t(
          '打散当前分组并按当前聚合方式重排；执行前自动存一份快照可回退（保存失败则取消重排）'
        ),
        run: actions.onQuickRegroup
      },
      {
        id: 'cleanDuplicates',
        label: t('清理重复标签'),
        icon: Icons.copyX,
        run: actions.onCleanDuplicates
      },
      {
        id: 'locate',
        label: t('定位当前标签'),
        icon: Icons.locate,
        run: actions.onLocateActive
      },
      {
        id: 'history',
        label: t('撤销历史'),
        icon: Icons.history,
        run: actions.onOpenHistory
      },
      {
        id: 'snapshots',
        label: t('快照'),
        icon: Icons.snapshot,
        run: actions.onOpenSnapshots
      },
      {
        id: 'saveSnapshot',
        label: t('保存当前窗口为快照'),
        icon: Icons.snapshot,
        run: actions.onSaveSnapshot
      },
      {
        id: 'saveSpace',
        label: t('保存当前窗口为工作区'),
        icon: Icons.layers,
        run: actions.onSaveSpace
      },
      {
        id: 'archive',
        label: t('归档当前窗口（关闭并保存）'),
        icon: Icons.snapshot,
        run: actions.onArchiveWindow
      },
      {
        /** 导出必须能在命令面板（⌘P）里搜到：「把数据拿出来」是本地优先产品的
            关键出口，不能只埋在设置页最末与引导终步。 */
        id: 'export',
        label: t('导出备份（JSON）'),
        icon: Icons.snapshot,
        run: actions.onExportData
      },
      {
        id: 'settings',
        label: t('设置'),
        icon: Icons.settings,
        run: actions.onOpenSettings
      },
      {
        id: 'about',
        label: t('查看能力总览'),
        icon: Icons.shield,
        hint: t('打开独立页面，完整浏览产品的全部能力与快捷键'),
        run: actions.onOpenAbout
      },
      {
        id: 'toggle',
        label: t('展开 / 收起所有分组'),
        icon: Icons.collapseAll,
        run: actions.onToggleAllSections
      },
      ...saveCmds,
      ...spaceCmds
    ];
    // 激活标签置顶 + 其余按最近访问降序（Spotlight 惯例），并携带网址供扫读图标。
    const tabCmds: CommandItem[] = [...tabs]
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
      })
      .map((tab) => ({
        id: `tab-${tab.id}`,
        label: tab.title || tab.url || '',
        icon: Icons.search,
        url: tab.url,
        current: tab.active,
        run: () => actions.onSwitchTab(tab.id)
      }));
    const q = query.trim().toLowerCase();
    if (!q) {
      // 空查询 = dashboard：最近关闭批次 + 最近快照（各 DASHBOARD_RECENT_LIMIT 条）+ 截断的标签直达。
      const recentItems: CommandItem[] = undoBatches
        .slice(-DASHBOARD_RECENT_LIMIT)
        .reverse()
        .map((batch) => {
          // 撤销条目不含标题（UndoTabRecord 只有 url/位置/组信息），展示用主机名。
          const firstUrl = batch.entries[0]?.url ?? '';
          // 主机名走 UrlInspector 的唯一口径，不在这里内联 new URL()：
          // 内联副本会漏掉 www 剥离 / 尾点归一，与列表里同一站点的展示不一致。
          const firstName = hostnameOf(firstUrl) || firstUrl;
          return {
            id: `undo-${batch.id}`,
            label:
              batch.entries.length > 1
                ? t('恢复刚关闭的 {{count}} 个标签（{{name}} 等）', {
                    count: batch.entries.length,
                    name: firstName
                  })
                : t('恢复刚关闭：{{name}}', { name: firstName }),
            icon: Icons.history,
            // undoBatch 自带互斥与成功/失败 toast，无需额外反馈。
            run: () => void useUndoStore.getState().undoBatch(batch.id)
          };
        });
      for (const snap of [...snapshots]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, DASHBOARD_RECENT_LIMIT)) {
        recentItems.push({
          id: `snap-${snap.id}`,
          label: snap.name,
          icon: Icons.snapshot,
          hint: t('{{count}} 个标签', { count: snap.tabCount }),
          // 不直接恢复：恢复会新建整批标签，必须先弹影响面确认
          // （与快照面板同一闸门），确认由下方弹窗执行。
          // 注：恢复产生的这批标签**已被登记进撤销栈**（见 snapshotStore 的
          // recordRestoreForUndo），可整批撤销回去；这里要拦的是「用户没意识到
          // 会新建 N 个标签」，不是「关不掉」。
          // 返回 false：确认框挂在本面板内，此处关闭面板会让它连同待确认的
          // 快照一起消失，恢复入口变成静默无响应。
          run: () => {
            setPendingRestore(snap);
            return false;
          }
        });
      }
      return {
        folderItems: folderCmds,
        commandItems: base,
        recentItems,
        tabItems: tabCmds.slice(0, EMPTY_QUERY_TAB_LIMIT),
        tabTruncated: tabCmds.length > EMPTY_QUERY_TAB_LIMIT
      };
    }
    const match = (c: CommandItem) => c.label.toLowerCase().includes(q);
    // 标签项走 SearchEngine（拼音/模糊命中，按相关度排序）；文件夹同内核（下标合成 id）；
    // 命令是 i18n 固定文案，保持子串过滤。
    const tabCmdById = new Map(tabCmds.map((cmd) => [cmd.id, cmd]));
    const matchedTabs = engine
      .search(q, tabCmds.length)
      .map((hit) => tabCmdById.get(`tab-${hit.tabId}`))
      .filter((cmd): cmd is CommandItem => cmd !== undefined);
    const matchedFolders = folderEngine
      .search(q, folderCmds.length)
      .map((hit) => folderCmds[hit.tabId])
      .filter((cmd): cmd is CommandItem => cmd !== undefined);
    return {
      folderItems: matchedFolders,
      commandItems: base.filter(match),
      recentItems: [],
      tabItems: matchedTabs,
      tabTruncated: false
    };
  }, [query, tabs, folders, t, actions, engine, folderEngine, undoBatches, snapshots]);

  /** 扁平顺序 = 键盘漫游顺序（文件夹 → 命令 → 最近 → 标签，与分组渲染顺序一致）。 */
  const commands = useMemo(
    () => [...folderItems, ...commandItems, ...recentItems, ...tabItems],
    [folderItems, commandItems, recentItems, tabItems]
  );

  useEffect(() => {
    setIndex(0);
  }, [query]);

  // 命令集收缩（标签关闭 / 过滤变窄）时钳制选中索引：越界时高亮消失、
  // aria-activedescendant 指向不存在的项、Enter 无动作。
  // 依赖 commands 引用而非 length：等长替换（过滤词微调）同样需要钳制。
  useEffect(() => {
    setIndex((current) => (commands.length === 0 ? 0 : Math.min(current, commands.length - 1)));
  }, [commands]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => (commands.length === 0 ? 0 : (i + 1) % commands.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => (commands.length === 0 ? 0 : (i - 1 + commands.length) % commands.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = commands[index];
      // 无命中 / 索引越界时提前返回，**不关闭面板**：与 SearchBar 的 Enter 分支
      // 口径一致（`selectedSearchTabId === undefined` 时直接 return）。
      // 否则用户在「什么都没选中」的状态下按回车会莫名关闭面板，只能重新唤起再输入。
      if (!command) return;
      // run 返回 false = 命令需要留在面板内继续交互（如快照恢复要先过确认闸门）。
      if (command.run() !== false) onClose();
    }
    // Esc 由 useModalA11y 统一处理（capture 阶段），此处不再重复。
  };

  // 键盘导航时把当前项滚入视野（命令 + 标签混排可达数十项，否则焦点会跑出可视区）。
  useEffect(() => {
    if (!commands[index]) return;
    document
      .getElementById(`palette-item-${commands[index].id}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index, commands]);

  // Portal 到 body：与 DialogShell 同层（z-stack 50 档），且不受 .app 的
  // container-type 层叠上下文影响。
  return createPortal(
    <div
      /* items-center 而非 pt-[12vh]：同层（z-50）的 DialogShell 是垂直居中的，
         从弹窗切到命令面板时面板位置会从屏幕中央跳到顶部 12% 处。两种模态
         落位语言必须一致。 */
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <dialog
        ref={panelRef}
        /* dialog-md 而非 max-w-md(448px)：后者既不在 .dialog-sm/.dialog-md 两档刻度内，
         也没有 vw 兜底，300px 侧边栏下会被外层 padding 挤成 268px，与同档弹窗不同宽。 */
        className="dialog-md modal-panel elev-3 relative m-0 overflow-hidden rounded-xl border border-gray-200 bg-surface p-0"
        aria-label={t('命令面板')}
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        // 点击遮罩关闭：dialog 经 showModal() 后背景被置 inert，外层容器收不到指针
        // 事件（原 onMouseDown 是死代码）；点击 ::backdrop 时事件 target 恰为 dialog
        // 元素本身，据此判定（target===currentTarget）即可实现「点暗区关闭」。
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {/* px-4：与下方选项（px-4）同线，头部与列表不得各用一套缩进 */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2">
          <Icon d={Icons.search} className="h-4 w-4 text-gray-500" />
          {/* combobox 四件套：role + aria-expanded + aria-controls + aria-activedescendant。
              只有 activedescendant 而缺少 listbox 上下文时，读屏会直接忽略该属性，
              键盘上下键移动时读屏用户完全无感知。 */}
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-sm text-gray-800 placeholder:text-gray-500"
            placeholder={t('输入命令或搜索标签…')}
            aria-label={t('输入命令或搜索标签…')}
            role="combobox"
            aria-expanded={commands.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              commands[index] ? `palette-item-${commands[index].id}` : undefined
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {/* 可见的关闭入口：只有 Esc / 点遮罩两条隐藏路径，用户不会知道怎么关。
              放在输入框之后 —— 「打开聚焦首项」仍落在输入框上。 */}
          <IconButton icon={Icons.close} box="md" title={t('关闭')} dismiss onClick={onClose} />
        </div>
        {/*
          刻意不使用原生 <select> + <option>：可自定义 select（option 内可放图标）
          需 Chrome 135+，而本扩展最低支持 Chrome 114。低于该版本时 HTML 解析器
          会直接丢弃 option 内的 svg 等富内容，图标全部丢失。
          ARIA combobox 模式允许 role=listbox/option 落在容器元素上（option 只需
          被 listbox 包含），故此处用 div + role 保持图标能力。
        */}
        <div
          id={listId}
          role="listbox"
          aria-label={t('命令面板')}
          /* overscroll-contain：本列表是浮层内的独立滚动区，不隔离会带动外层页面
             scroll-fade：结果被 max-h-72 截断，底部渐隐提示「还有更多」 */
          ref={listScrollRef}
          className="scroll-fade max-h-72 overflow-y-auto overscroll-contain py-1"
        >
          {commands.length === 0 && (
            /* 与截断提示同口径：listbox 语义内只允许 option，说明性文本放外面
               （读屏可达，且不混入键盘漫游序列）。 */
            <div
              role="presentation"
              className="px-4 py-3 text-center text-3xs text-gray-500"
              aria-live="polite"
            >
              {t('没有匹配的命令或标签')}
            </div>
          )}
          {folderItems.length > 0 && (
            <div
              role="presentation"
              className="px-4 pb-1 pt-2 text-3xs font-medium tracking-wide text-gray-500"
            >
              {t('打开收藏夹文件夹')}
            </div>
          )}
          {folderItems.map((cmd, folderIndex) => (
            <PaletteOption
              key={cmd.id}
              cmd={cmd}
              /* 该项在扁平漫游序列中的下标 = 文件夹组长度 + 组内序号 */
              selected={folderIndex === index}
              onSelect={() => setIndex(folderIndex)}
              onRun={() => {
                // 与键盘 Enter 同口径：run 返回 false 时保留面板（快照恢复的确认闸门）。
                if (cmd.run() !== false) onClose();
              }}
            />
          ))}
          {commandItems.length > 0 && (
            /* 分组标题对读屏隐藏（role=presentation）：listbox 语义内只保留 option，
             分组信息通过命令/标签的 label 本身已可区分。 */
            <div
              role="presentation"
              className="px-4 pb-1 pt-2 text-3xs font-medium tracking-wide text-gray-500"
            >
              {t('命令')}
            </div>
          )}
          {commandItems.map((cmd, i) => (
            <Fragment key={cmd.id}>
              {/* 组内再分标题：13 条命令平铺时，找「设置」要扫过全部。
                  组标题对读屏隐藏（role=presentation）：listbox 内只保留 option，
                  分组信息由命令自身的 label 承载。 */}
              {commandGroupOf(cmd.id) !== commandGroupOf(commandItems[i - 1]?.id) && (
                <div
                  role="presentation"
                  className="px-4 pb-0.5 pt-1.5 text-3xs font-medium tracking-wide text-gray-400"
                >
                  {commandGroupLabel(commandGroupOf(cmd.id), t)}
                </div>
              )}
              <PaletteOption
                cmd={cmd}
                selected={folderItems.length + i === index}
                onSelect={() => setIndex(folderItems.length + i)}
                onRun={() => {
                  // 与键盘 Enter 同口径：run 返回 false 时保留面板（快照恢复的确认闸门）。
                  if (cmd.run() !== false) onClose();
                }}
              />
            </Fragment>
          ))}
          {recentItems.length > 0 && (
            <div
              role="presentation"
              className="px-4 pb-1 pt-2 text-3xs font-medium tracking-wide text-gray-500"
            >
              {t('最近关闭与快照')}
            </div>
          )}
          {recentItems.map((cmd, i) => (
            <PaletteOption
              key={cmd.id}
              cmd={cmd}
              /* 该项下标 = 文件夹组 + 命令组长度 + 组内序号 */
              selected={folderItems.length + commandItems.length + i === index}
              onSelect={() => setIndex(folderItems.length + commandItems.length + i)}
              onRun={() => {
                // 与键盘 Enter 同口径：run 返回 false 时保留面板（快照恢复的确认闸门）。
                if (cmd.run() !== false) onClose();
              }}
            />
          ))}
          {tabItems.length > 0 && (
            <div
              role="presentation"
              className="px-4 pb-1 pt-2 text-3xs font-medium tracking-wide text-gray-500"
            >
              {t('切换到标签')}
            </div>
          )}
          {tabItems.map((cmd, groupIndex) => (
            <PaletteOption
              key={cmd.id}
              cmd={cmd}
              /* 该项在扁平漫游序列中的下标 = 前三组长度 + 组内序号 */
              selected={
                folderItems.length + commandItems.length + recentItems.length + groupIndex === index
              }
              onSelect={() =>
                setIndex(folderItems.length + commandItems.length + recentItems.length + groupIndex)
              }
              onRun={() => {
                // 与键盘 Enter 同口径：run 返回 false 时保留面板（快照恢复的确认闸门）。
                if (cmd.run() !== false) onClose();
              }}
            />
          ))}
        </div>
        {tabTruncated && (
          /* 截断提示放在 listbox 外：listbox 语义内只允许 option，提示行若藏进
             listbox 只能 role=presentation，读屏用户无从得知列表被截断。 */
          <div className="border-t border-gray-100 px-4 py-1.5 text-3xs text-gray-500">
            {t('仅显示前 {{count}} 个标签，输入关键词以过滤更多', { count: EMPTY_QUERY_TAB_LIMIT })}
          </div>
        )}
        {/* 快照恢复闸门：与快照面板同一组件（恢复可整批撤销，但仍需前置影响面确认）。
            放在 dialog 内、listbox 外，不干扰键盘漫游序列。 */}
        {pendingRestore !== null && (
          <RestoreConfirmDialog
            snapshot={pendingRestore}
            onConfirm={() => {
              const snap = pendingRestore;
              setPendingRestore(null);
              void useSnapshotStore
                .getState()
                .restore(snap.id)
                .then(({ count, degraded }) => {
                  if (count === 0) {
                    useUndoStore.getState().notify(t('该快照没有可恢复的标签'));
                    return;
                  }
                  useUndoStore
                    .getState()
                    .notify(
                      degraded
                        ? t(
                            '已恢复 {{count}} 个标签；未能读取窗口现状，可能多开了已经打开着的页面',
                            { count }
                          )
                        : t('已恢复 {{count}} 个标签', { count })
                    );
                })
                .catch((error: unknown) =>
                  useUndoStore
                    .getState()
                    .notifyFailure('command-palette', t('操作失败，请稍后重试'), error)
                );
              onClose();
            }}
            onCancel={() => setPendingRestore(null)}
          />
        )}
      </dialog>
    </div>,
    document.body
  );
}
