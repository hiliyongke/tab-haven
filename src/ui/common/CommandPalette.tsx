import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import type { TabRecord } from '@/core/tab-types';
import { Icon, Icons } from '@/ui/common/Icon';
import { useModalA11y } from '@/ui/dialog/Dialog';

/** 命令面板的动作回调集合（由 sidepanel App 注入，复用既有 handler）。 */
export interface PaletteActions {
  onDiscardInactive: () => void;
  onWakeAll: () => void;
  onQuickRegroup: () => void;
  onLocateActive: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onToggleAllSections: () => void;
  onSwitchTab: (tabId: number) => void;
  onOpenSnapshots: () => void;
  onSaveSnapshot: () => void;
  onArchiveWindow: () => void;
  onSaveSpace: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

/** listbox 内的单个选项（命令 / 标签通用）：图标 + 截断标签 + 选中态。 */
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
      <Icon d={cmd.icon} className="h-4 w-4 shrink-0 opacity-70" />
      <span className="truncate">{cmd.label}</span>
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
  actions,
  onClose
}: {
  tabs: readonly TabRecord[];
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

  // 命令与标签分组（P2-5）：键盘漫游顺序保持「命令 → 标签」不变，
  // 仅在视觉上插入分组标题，让混排的数十项结果可按类别扫读。
  const { commandItems, tabItems } = useMemo(() => {
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
        run: actions.onQuickRegroup
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
    const tabCmds: CommandItem[] = tabs.map((tab) => ({
      id: `tab-${tab.id}`,
      label: tab.title || tab.url || '',
      icon: Icons.search,
      run: () => actions.onSwitchTab(tab.id)
    }));
    const q = query.trim().toLowerCase();
    if (!q) return { commandItems: base, tabItems: tabCmds };
    const match = (c: CommandItem) => c.label.toLowerCase().includes(q);
    return { commandItems: base.filter(match), tabItems: tabCmds.filter(match) };
  }, [query, tabs, t, actions]);

  /** 扁平顺序 = 键盘漫游顺序（命令组在前，与分组渲染顺序一致）。 */
  const commands = useMemo(() => [...commandItems, ...tabItems], [commandItems, tabItems]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  // 命令集收缩（标签关闭 / 过滤变窄）时钳制选中索引：越界时高亮消失、
  // aria-activedescendant 指向不存在的项、Enter 无动作。
  useEffect(() => {
    setIndex((current) => (commands.length === 0 ? 0 : Math.min(current, commands.length - 1)));
  }, [commands.length]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => (commands.length === 0 ? 0 : (i + 1) % commands.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => (commands.length === 0 ? 0 : (i - 1 + commands.length) % commands.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commands[index]?.run();
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      role="presentation"
    >
      <dialog
        ref={panelRef}
        className="relative m-0 w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-surface p-0 shadow-lg"
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
            <div className="px-4 py-3 text-center text-2xs text-gray-500">{t('palette.empty')}</div>
          )}
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
              selected={i === index}
              onSelect={() => setIndex(i)}
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
              /* 该项在扁平漫游序列中的下标 = 命令组长度 + 组内序号 */
              selected={commandItems.length + groupIndex === index}
              onSelect={() => setIndex(commandItems.length + groupIndex)}
              onRun={() => {
                cmd.run();
                onClose();
              }}
            />
          ))}
        </div>
      </dialog>
    </div>,
    document.body
  );
}
