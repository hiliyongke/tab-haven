import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { FixedFolder, Snapshot, UndoBatch } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { SearchEngine } from '@/core/search/SearchEngine';
import { hostnameOf } from '@/core/url/UrlInspector';
import { Icons } from '@/ui/common/Icon';
import { useUndoStore } from '@/stores/undoStore';

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

export interface CommandItem {
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
export const EMPTY_QUERY_TAB_LIMIT = 20;
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
export function commandGroupOf(id: string | undefined): CommandGroup | '' {
  if (id === undefined) return '';
  return COMMAND_GROUPS[id] ?? 'open';
}
/** 分组标识 → 中文原文（字面量调用点，扫描器据此抽词）。 */
export function commandGroupLabel(group: CommandGroup | '', t: (key: string) => string): string {
  if (group === 'organize') return t('整理');
  if (group === 'record') return t('记录');
  return t('打开');
}

export interface PaletteCommands {
  folderItems: CommandItem[];
  commandItems: CommandItem[];
  recentItems: CommandItem[];
  tabItems: CommandItem[];
  tabTruncated: boolean;
}

/**
 * 命令面板的**结果派生**：把标签 / 文件夹 / 快照 / 撤销栈折算成四组可漫游项。
 *
 * 从面板组件里拆出来的原因：这段是纯派生（无渲染、无副作用），却占了原文件
 * 近三分之一；与渲染同处一个文件时，改一条命令的文案要在两百行 JSX 里定位。
 */
export function usePaletteCommands({
  tabs,
  folders,
  actions,
  query,
  engine,
  folderEngine,
  undoBatches,
  snapshots,
  onRequestRestore
}: {
  tabs: readonly TabRecord[];
  folders: readonly FixedFolder[];
  actions: PaletteActions;
  query: string;
  engine: SearchEngine;
  folderEngine: SearchEngine;
  undoBatches: readonly UndoBatch[];
  snapshots: readonly Snapshot[];
  /** 快照恢复要先过确认闸门：此处只登记「待确认」，不直接恢复。 */
  onRequestRestore: (snapshot: Snapshot) => void;
}): PaletteCommands {
  const { t } = useTranslation();
  return useMemo(() => {
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
          // （与快照面板同一闸门），确认由面板内的弹窗执行。
          // 注：恢复产生的这批标签**已被登记进撤销栈**（见 snapshotStore 的
          // recordRestoreForUndo），可整批撤销回去；这里要拦的是「用户没意识到
          // 会新建 N 个标签」，不是「关不掉」。
          // 返回 false：确认框挂在本面板内，此处关闭面板会让它连同待确认的
          // 快照一起消失，恢复入口变成静默无响应。
          run: () => {
            onRequestRestore(snap);
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
  }, [
    query,
    tabs,
    folders,
    t,
    actions,
    engine,
    folderEngine,
    undoBatches,
    snapshots,
    onRequestRestore
  ]);
}
