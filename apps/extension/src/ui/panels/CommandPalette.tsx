import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '@/i18n';
import type { FixedFolder, Snapshot } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { RestoreConfirmDialog } from '@/ui/snapshot/RestoreConfirmDialog';
import { SearchEngine } from '@/core/search/SearchEngine';
import { useDataStore } from '@/stores/dataStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import { useUndoStore } from '@/stores/undoStore';
import { Icon, Icons } from '@/ui/common/Icon';
import { IconButton } from '@/ui/common/IconButton';
import { TextField } from '@/ui/common/TextField';
import { useScrollFade } from '@/ui/common/useScrollFade';
import { useModalA11y } from '@/ui/dialog/Dialog';
import { usePinyinDictionary } from '@/ui/search/usePinyinDictionary';
import { PaletteList } from '@/ui/panels/PaletteList';
import { type PaletteActions, usePaletteCommands } from '@/ui/panels/paletteCommands';

export type { PaletteActions };

/**
 * 命令面板：⌘P / Ctrl+P 唤起，可搜可执行。
 * 既能跑动作命令（休眠/整理/定位/设置…），也能「切换到标签」，
 * 把 ⌘K 的搜索能力升级为完整 Spotlight 式入口。纯交互增益、零隐私成本。
 *
 * 本文件只保留**外壳与键盘状态机**：结果派生在 `paletteCommands`、
 * 列表渲染在 `PaletteList`、单个选项在 `paletteOption`，三者都从原 761 行里
 * 拆出 —— 拆分的判据是「渲染 / 派生 / 状态机」三者互不复用、却互相挤占定位。
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
  // 引用必须稳定：它是结果派生的 useMemo 依赖，每次渲染换引用会让派生白算一遍。
  const requestRestore = useCallback((snapshot: Snapshot) => setPendingRestore(snapshot), []);

  // 命令与标签分组：键盘漫游顺序保持「文件夹 → 命令 → 最近 → 标签」不变，
  // 仅在视觉上插入分组标题，让混排的数十项结果可按类别扫读。
  const { folderItems, commandItems, recentItems, tabItems, tabTruncated } = usePaletteCommands({
    tabs,
    folders,
    actions,
    query,
    engine,
    folderEngine,
    undoBatches,
    snapshots,
    onRequestRestore: requestRestore
  });

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

  /** 与键盘 Enter 同口径：run 返回 false 时保留面板（快照恢复的确认闸门）。 */
  const runCommand = (command: (typeof commands)[number]) => {
    if (command.run() !== false) onClose();
  };

  // 事件类型与 TextField.onKeyDown 对齐（单行 / 多行共用的元素并集）：
  // 本面板只有单行输入，但收口组件的处理器类型是二者并集，写窄了传不进去。
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
      runCommand(command);
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
        /* m-auto 而非 m-0：本元素是原生 <dialog>，showModal() 后进入 top layer 并脱离
           文档流 —— 外层 .modal-overlay 的 items-center / justify-center 对它无效
           （DialogShell 用的是 <div>，靠父级居中是对的，别照抄到这里）。
           <dialog> 的居中来自浏览器默认的 margin:auto，写 m-0 会把它钉在左上角。 */
        className="dialog-md modal-panel modal-surface relative m-auto overflow-hidden p-0"
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
        {/* input-row：与侧边栏搜索框同一组下划线声明（原 border-b border-gray-200
            既不是控件边框令牌，也与搜索框不同色 —— main.css 明确禁止控件用
            border-gray-200）。内部 input 保持无边框，否则叠成双线。 */}
        {/* 不写 gap：内部输入改走 TextField（自带 px-2），容器再留 8px 会让
            输入框文字比搜索图标右移 8px —— 由输入的内边距承担同一条 8px 间距。 */}
        <div className="input-row flex items-center px-4 py-2">
          <Icon d={Icons.search} className="h-4 w-4 text-gray-500" />
          {/* combobox 四件套：role + aria-expanded + aria-controls + aria-activedescendant。
              只有 activedescendant 而缺少 listbox 上下文时，读屏会直接忽略该属性，
              键盘上下键移动时读屏用户完全无感知。 */}
          <TextField
            variant="bare"
            className="w-full placeholder:text-gray-500"
            placeholder={t('输入命令或搜索标签…')}
            ariaLabel={t('输入命令或搜索标签…')}
            inputProps={{
              role: 'combobox',
              'aria-expanded': commands.length > 0,
              'aria-controls': listId,
              'aria-autocomplete': 'list',
              'aria-activedescendant': commands[index]
                ? `palette-item-${commands[index].id}`
                : undefined
            }}
            value={query}
            onChange={setQuery}
            onKeyDown={handleKeyDown}
          />
          {/* 可见的关闭入口：只有 Esc / 点遮罩两条隐藏路径，用户不会知道怎么关。
              放在输入框之后 —— 「打开聚焦首项」仍落在输入框上。 */}
          <IconButton icon={Icons.close} size="md" label={t('关闭')} dismiss onClick={onClose} />
        </div>
        {/*
          刻意不使用原生 <select> + <option>：可自定义 select（option 内可放图标）
          需 Chrome 135+，而本扩展最低支持 Chrome 114。低于该版本时 HTML 解析器
          会直接丢弃 option 内的 svg 等富内容，图标全部丢失。
          ARIA combobox 模式允许 role=listbox/option 落在容器元素上（option 只需
          被 listbox 包含），故此处用 div + role 保持图标能力。
        */}
        <PaletteList
          listId={listId}
          scrollRef={listScrollRef}
          folderItems={folderItems}
          commandItems={commandItems}
          recentItems={recentItems}
          tabItems={tabItems}
          tabTruncated={tabTruncated}
          activeIndex={index}
          onHover={setIndex}
          onRun={runCommand}
        />
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
