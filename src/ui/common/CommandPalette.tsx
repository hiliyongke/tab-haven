import { useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * 命令面板（P1 键盘流）：⌘P / Ctrl+P 唤起，可搜可执行。
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
  // 与弹窗族统一的行为契约：焦点陷阱 + Esc 关闭 + 关闭后焦点恢复
  // （此前用非模态 <dialog open>，Tab 可逃出背景、Esc 仅在输入框聚焦时有效）。
  useModalA11y(panelRef, onClose);

  const commands = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      { id: 'discard', label: t('discard.allInactive'), icon: Icons.snowflake, run: actions.onDiscardInactive },
      { id: 'wake', label: t('discard.wakeAll'), icon: Icons.wakeAll, run: actions.onWakeAll },
      { id: 'regroup', label: t('footer.quickRegroup'), icon: Icons.quickRegroup, run: actions.onQuickRegroup },
      { id: 'locate', label: t('tabs.locateActive'), icon: Icons.locate, run: actions.onLocateActive },
      { id: 'history', label: t('undo.historyTitle'), icon: Icons.history, run: actions.onOpenHistory },
      { id: 'snapshots', label: t('snapshots.title'), icon: Icons.snapshot, run: actions.onOpenSnapshots },
      { id: 'saveSnapshot', label: t('snapshots.saveCurrent'), icon: Icons.snapshot, run: actions.onSaveSnapshot },
      { id: 'saveSpace', label: t('snapshots.space'), icon: Icons.folder, run: actions.onSaveSpace },
      { id: 'archive', label: t('snapshots.archiveCurrent'), icon: Icons.snapshot, run: actions.onArchiveWindow },
      { id: 'settings', label: t('settings.title'), icon: Icons.settings, run: actions.onOpenSettings },
      { id: 'toggle', label: t('footer.collapseAll'), icon: Icons.collapseAll, run: actions.onToggleAllSections }
    ];
    const tabCmds: CommandItem[] = tabs.map((tab) => ({
      id: `tab-${tab.id}`,
      label: tab.title || tab.url || '',
      icon: Icons.search,
      run: () => actions.onSwitchTab(tab.id)
    }));
    const all = [...base, ...tabCmds];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => c.label.toLowerCase().includes(q));
  }, [query, tabs, t, actions]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

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

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        ref={panelRef}
        className="relative m-0 w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-surface p-0 shadow-lg"
        aria-modal="true"
        aria-label={t('palette.title')}
      >
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
          <Icon d={Icons.search} className="h-4 w-4 text-gray-500" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-sm text-gray-800 placeholder:text-gray-500"
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            aria-activedescendant={commands[index] ? `palette-item-${commands[index].id}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <ul className="max-h-72 overflow-y-auto py-1" aria-label={t('palette.title')}>
          {commands.length === 0 && (
            <li className="px-4 py-3 text-center text-2xs text-gray-500">{t('palette.empty')}</li>
          )}
          {commands.map((cmd, i) => (
            <li key={cmd.id} role="presentation">
              <button
                type="button"
                id={`palette-item-${cmd.id}`}
                tabIndex={-1}
                className={
                  'flex w-full items-center gap-2 px-4 py-2 text-left text-sm ' +
                  (i === index ? 'bg-accent-50 text-accent-700' : 'text-gray-700 hover:bg-gray-50')
                }
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
              >
                <Icon d={cmd.icon} className="h-4 w-4 shrink-0 opacity-70" />
                <span className="truncate">{cmd.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </div>
  );
}
