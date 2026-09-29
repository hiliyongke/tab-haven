import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import type { FixedFolder, Snapshot } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { RestoreConfirmDialog } from '@/ui/common/RestoreConfirmDialog';
import { SearchEngine } from '@/core/search/SearchEngine';
import { useDataStore } from '@/stores/dataStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { logDegraded } from '@/platform/diagnostics';
import { Icon, Icons } from '@/ui/common/Icon';
import { Favicon } from '@/ui/common/Favicon';
import { useModalA11y } from '@/ui/dialog/Dialog';

/** 命令面板的动作回调集合（由 sidepanel App 注入，复用既有 handler）。 */
export interface PaletteActions {
  onDiscardInactive: () => void;
  onWakeAll: () => void;
  onQuickRegroup: () => void;
  /** 一键清理重复标签（保留每网址的激活/固定/最早者，可撤销）。 */
  onCleanDuplicates: () => void;
  onLocateActive: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onToggleAllSections: () => void;
  onSwitchTab: (tabId: number) => void;
  onOpenSnapshots: () => void;
  onSaveSnapshot: () => void;
  onArchiveWindow: () => void;
  onSaveSpace: () => void;
  /** 把当前激活标签加入稍后读（C3）。 */
  onReadLaterActive: () => void;
  /** 打开指定固定文件夹的全部条目（P-04：文件夹即空间）。 */
  onOpenFolder: (folderId: string) => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** 标签项携带网站图标（favicon 失败回退首字母），扫读效率远高于统一放大镜。 */
  favIconUrl?: string;
  /** 是否为当前激活标签（显示「当前」标记并置顶）。 */
  current?: boolean;
  /** 可选说明行：破坏性操作（如重排分组）需要在这里讲清影响面。 */
  hint?: string;
  run: () => void;
}

/** 空查询时标签项的挂载上限（含 Favicon 的行有真实渲染成本；输入后过滤路径不受限）。 */
const EMPTY_QUERY_TAB_LIMIT = 20;

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
        'flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm outline-none ' +
        (selected ? 'bg-accent-50 text-accent-700' : 'text-gray-700 hover:bg-gray-50')
      }
      onMouseEnter={onSelect}
      onClick={onRun}
    >
      {cmd.favIconUrl ? (
        <span className="flex shrink-0 items-center">
          <Favicon src={cmd.favIconUrl} title={cmd.label} size={16} />
        </span>
      ) : (
        <Icon d={cmd.icon} className="h-4 w-4 shrink-0 opacity-70" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{cmd.label}</span>
        {/* 字号走 text-3xs：项目纪律「正文说明 ≥ 11px」（text-2xs 仅限图标内文/徽角），
            由 design-tokens 守卫强制。 */}
        {cmd.hint && (
          <span className="block truncate text-3xs leading-snug text-gray-400">{cmd.hint}</span>
        )}
      </span>
      {cmd.current && (
        <span className="shrink-0 rounded bg-accent-100 px-1 text-3xs font-medium text-accent-700">
          {t('palette.current')}
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
  /** 固定文件夹列表（P-04 动态命令：每个文件夹一个「打开全部」命令）。 */
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
  // 此前面板用裸 includes，中文标题输拼音首字母命中不了，同一产品两套搜索口径。
  // 命令（i18n 固定文案）与文件夹保持子串过滤。
  const pinyinSearch = useDataStore((state) => state.settings.pinyinSearch);
  const engine = useMemo(
    () =>
      new SearchEngine(
        tabs.map((tab) => ({
          id: tab.id,
          title: tab.title ?? '',
          url: tab.url ?? '',
          active: tab.active
        })),
        { pinyin: pinyinSearch }
      ),
    [tabs, pinyinSearch]
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
        { pinyin: pinyinSearch }
      ),
    [folders, pinyinSearch]
  );
  // 拼音词典异步就绪后触发重算（与 popup / useSearchController 同口径）。
  const [pinyinTick, setPinyinTick] = useState(0);
  useEffect(() => {
    if (engine.pinyinReady && folderEngine.pinyinReady) return;
    let cancelled = false;
    void Promise.all([engine.ensurePinyin(), folderEngine.ensurePinyin()])
      .then(() => {
        if (!cancelled) setPinyinTick((tick) => tick + 1);
      })
      .catch((error: unknown) => {
        logDegraded('search', '拼音词典加载失败，命令面板拼音匹配暂不可用', error);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, folderEngine]);

  // 空查询 dashboard 数据源（栈尾为最新批次；快照按时间降序取前 3）。
  const undoBatches = useUndoStore((state) => state.batches);
  const snapshots = useSnapshotStore((state) => state.snapshots);
  /** 待确认恢复的快照（恢复影响面闸门，与快照面板共用同一组件）。 */
  const [pendingRestore, setPendingRestore] = useState<Snapshot | null>(null);

  // 命令与标签分组（P2-5）：键盘漫游顺序保持「文件夹 → 命令 → 最近 → 标签」不变，
  // 仅在视觉上插入分组标题，让混排的数十项结果可按类别扫读。
  // 文件夹命令（P-04）：每个固定文件夹一个「打开全部条目」命令 ——
  // 「文件夹即空间」的命令面板入口，键入空间名直达。
  const { folderItems, commandItems, recentItems, tabItems, tabTruncated } = useMemo(() => {
    const folderCmds: CommandItem[] = folders.map((folder) => ({
      id: `folder-${folder.id}`,
      label: folder.name,
      icon: Icons.folder,
      hint: t('palette.openFolderHint', { count: folder.items.length }),
      run: () => actions.onOpenFolder(folder.id)
    }));
    const base: CommandItem[] = [
      {
        id: 'discard',
        label: t('discard.allInactive'),
        icon: Icons.snowflake,
        run: actions.onDiscardInactive
      },
      { id: 'wake', label: t('discard.wakeAll'), icon: Icons.wakeAll, run: actions.onWakeAll },
      {
        id: 'regroup',
        label: t('footer.quickRegroup'),
        icon: Icons.quickRegroup,
        hint: t('footer.quickRegroupHint'),
        run: actions.onQuickRegroup
      },
      {
        id: 'cleanDuplicates',
        label: t('duplicates.clean'),
        icon: Icons.copyX,
        run: actions.onCleanDuplicates
      },
      {
        id: 'locate',
        label: t('tabs.locateActive'),
        icon: Icons.locate,
        run: actions.onLocateActive
      },
      {
        id: 'history',
        label: t('undo.historyTitle'),
        icon: Icons.history,
        run: actions.onOpenHistory
      },
      {
        id: 'readLater',
        label: t('readlater.addActive'),
        icon: Icons.bookmarkAdd,
        run: actions.onReadLaterActive
      },
      {
        id: 'snapshots',
        label: t('snapshots.title'),
        icon: Icons.snapshot,
        run: actions.onOpenSnapshots
      },
      {
        id: 'saveSnapshot',
        label: t('snapshots.saveCurrent'),
        icon: Icons.snapshot,
        run: actions.onSaveSnapshot
      },
      {
        id: 'saveSpace',
        label: t('snapshots.saveSpacePalette'),
        icon: Icons.layers,
        run: actions.onSaveSpace
      },
      {
        id: 'archive',
        label: t('snapshots.archiveCurrent'),
        icon: Icons.snapshot,
        run: actions.onArchiveWindow
      },
      {
        id: 'settings',
        label: t('settings.title'),
        icon: Icons.settings,
        run: actions.onOpenSettings
      },
      {
        id: 'toggle',
        label: t('footer.collapseAll'),
        icon: Icons.collapseAll,
        run: actions.onToggleAllSections
      }
    ];
    // 激活标签置顶 + 其余按最近访问降序（Spotlight 惯例），并携带 favicon 供扫读。
    const tabCmds: CommandItem[] = [...tabs]
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
      })
      .map((tab) => ({
        id: `tab-${tab.id}`,
        label: tab.title || tab.url || '',
        icon: Icons.search,
        favIconUrl: tab.favIconUrl,
        current: tab.active,
        run: () => actions.onSwitchTab(tab.id)
      }));
    const q = query.trim().toLowerCase();
    // pinyinTick 是词典异步就绪后的重算触发器，引用它让依赖数组语义自足（不写豁免注释）。
    void pinyinTick;
    if (!q) {
      // 空查询 = dashboard：最近关闭批次 + 最近快照（各前 3 条）+ 截断的标签直达。
      const recentItems: CommandItem[] = undoBatches
        .slice(-3)
        .reverse()
        .map((batch) => {
          // 撤销条目不含标题（UndoTabRecord 只有 url/位置/组信息），展示用主机名。
          const firstUrl = batch.entries[0]?.url ?? '';
          let firstName = firstUrl;
          try {
            firstName = new URL(firstUrl).hostname || firstUrl;
          } catch {
            // 非标准 URL：原样展示
          }
          return {
            id: `undo-${batch.id}`,
            label:
              batch.entries.length > 1
                ? t('palette.recentClosedMany', { count: batch.entries.length, name: firstName })
                : t('palette.recentClosedOne', { name: firstName }),
            icon: Icons.history,
            // undoBatch 自带互斥与成功/失败 toast，无需额外反馈。
            run: () => void useUndoStore.getState().undoBatch(batch.id)
          };
        });
      for (const snap of [...snapshots].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)) {
        recentItems.push({
          id: `snap-${snap.id}`,
          label: snap.name,
          icon: Icons.snapshot,
          hint: t('palette.recentSnapshotHint', { count: snap.tabCount }),
          // 不直接恢复：恢复会新建整批标签且不在撤销栈覆盖范围内，
          // 必须先弹影响面确认（与快照面板同一闸门），确认由下方弹窗执行。
          run: () => setPendingRestore(snap)
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
  }, [query, tabs, folders, t, actions, engine, folderEngine, pinyinTick, undoBatches, snapshots]);

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
      command.run();
      onClose();
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
      className="modal-overlay fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      role="presentation"
    >
      <dialog
        ref={panelRef}
        className="modal-panel elev-3 relative m-0 w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-surface p-0"
        aria-label={t('palette.title')}
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
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
          <Icon d={Icons.search} className="h-4 w-4 text-gray-500" />
          {/* combobox 四件套：role + aria-expanded + aria-controls + aria-activedescendant。
              此前只有 activedescendant 而缺少 listbox 上下文，读屏会直接忽略该属性，
              键盘上下键移动时读屏用户完全无感知。 */}
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-sm text-gray-800 placeholder:text-gray-500"
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
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
          aria-label={t('palette.title')}
          className="max-h-72 overflow-y-auto py-1"
        >
          {commands.length === 0 && (
            /* 与截断提示同口径：listbox 语义内只允许 option，说明性文本放外面
               （读屏可达，且不混入键盘漫游序列）。 */
            <div
              role="presentation"
              className="px-4 py-3 text-center text-2xs text-gray-500"
              aria-live="polite"
            >
              {t('palette.empty')}
            </div>
          )}
          {folderItems.length > 0 && (
            <div role="presentation" className="px-4 pb-1 pt-2 text-2xs font-medium text-gray-400">
              {t('palette.sectionFolders')}
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
                cmd.run();
                onClose();
              }}
            />
          ))}
          {commandItems.length > 0 && (
            /* 分组标题对读屏隐藏（role=presentation）：listbox 语义内只保留 option，
             分组信息通过命令/标签的 label 本身已可区分。 */
            <div role="presentation" className="px-4 pb-1 pt-2 text-2xs font-medium text-gray-400">
              {t('palette.sectionCommands')}
            </div>
          )}
          {commandItems.map((cmd, i) => (
            <PaletteOption
              key={cmd.id}
              cmd={cmd}
              selected={folderItems.length + i === index}
              onSelect={() => setIndex(folderItems.length + i)}
              onRun={() => {
                cmd.run();
                onClose();
              }}
            />
          ))}
          {recentItems.length > 0 && (
            <div role="presentation" className="px-4 pb-1 pt-2 text-2xs font-medium text-gray-400">
              {t('palette.sectionRecent')}
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
                cmd.run();
                onClose();
              }}
            />
          ))}
          {tabItems.length > 0 && (
            <div role="presentation" className="px-4 pb-1 pt-2 text-2xs font-medium text-gray-400">
              {t('palette.sectionTabs')}
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
                cmd.run();
                onClose();
              }}
            />
          ))}
        </div>
        {tabTruncated && (
          /* 截断提示放在 listbox 外：listbox 语义内只允许 option，提示行若藏进
             listbox 只能 role=presentation，读屏用户无从得知列表被截断。 */
          <div className="border-t border-gray-100 px-4 py-1.5 text-2xs text-gray-400">
            {t('palette.tabsTruncated', { count: EMPTY_QUERY_TAB_LIMIT })}
          </div>
        )}
        {/* 快照恢复闸门：与快照面板同一组件（恢复不在撤销栈覆盖范围）。
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
                .then((count) => {
                  if (count > 0) useUndoStore.getState().notify(t('snapshots.restored', { count }));
                  else useUndoStore.getState().notify(t('snapshots.empty'));
                })
                .catch(() => useUndoStore.getState().notifyError(t('errors.operationFailed')));
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
