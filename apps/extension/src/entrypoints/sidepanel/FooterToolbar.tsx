import { type ComponentProps, type ReactNode } from 'react';
import { useDndMonitor } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { useTranslation } from '@/i18n';
import {
  FOOTER_ID_PREFIX,
  footerButtonId,
  footerButtonKeyFromId,
  type FooterButtonId,
  type FooterButtonKey
} from '@/core/layout/footerOrder';
import { IconButton } from '@/ui/common/IconButton';
import { Icons } from '@/ui/common/Icon';

/**
 * 底部工具区：标签计数 + 可按使用频率重排的快捷功能组。
 * 从 sidepanel App 拆出，保持渲染层纯粹（逻辑由回调注入，含顺序持久化）。
 *
 * 按钮顺序可拖拽自定义：顺序由 `footerOrder` prop 注入、改动经 `onReorderFooter`
 * 上抛，本组件不直接碰存储。
 */

/**
 * 底栏按钮的配置项（与 IconButton 的 props 同构，渲染处统一补可见文字）。
 *
 * `label` 是完整说明（可访问名 + 悬停提示），`text` 是窄档会隐藏的短文字标签；
 * 两者刻意不同 —— 提示要能看懂「这是什么」，可见文字只够放两三个字。
 */
type FooterButtonSpec = Pick<
  ComponentProps<typeof IconButton>,
  'icon' | 'label' | 'text' | 'badge' | 'disabled' | 'tone' | 'onClick'
>;

/**
 * 可拖拽的按钮外壳。
 *
 * 刻意**不展开** `attributes`：它含 `role="button"` 与 `tabIndex=0`，挂到外壳 span 上
 * 会让底栏的 Tab 停靠点从 13 个变成 26 个（外壳 + 内部真按钮各一个），键盘用户
 * 每次都要多按一倍。这里只挂 `listeners`（指针拖拽），键盘可达性交给内部真按钮：
 * 底栏排序本身是可选偏好，键盘用户仍能 Tab 到每个按钮并 Enter 触发功能。
 */
function SortableFooterButton({ id, children }: { id: string; children: ReactNode }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <span
      ref={setNodeRef}
      className={'footer-button' + (isDragging ? ' is-dragging' : '')}
      style={{
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition: transition ?? undefined,
        // 拖拽中的按钮要盖住相邻项，否则会被邻居的图标 / 计数徽章压住
        zIndex: isDragging ? 30 : undefined
      }}
      {...listeners}
    >
      {children}
    </span>
  );
}
interface FooterToolbarProps {
  tabCount: number;
  /** 可折叠分区数（原生组 + 站点组），为 0 时折叠按钮禁用。 */
  collapsibleCount: number;
  allCollapsed: boolean;
  activeTabId: number | undefined;
  /** 休眠中的标签数（>0 时显示唤醒全部按钮）。 */
  discardedCount: number;
  /** 可休眠的标签数（>0 时休眠入口的提示带数量，让影响面在按下前可见）。 */
  sleepableCount: number;
  /** 可清理的重复标签数（>0 时显示清理重复入口，徽章显示待清理数）。 */
  duplicateCount: number;
  /**
   * 存在待处理的习惯洞察（重复 / 休眠候选 / 滞留预警任一命中）时显示洞察入口。
   * 洞察若只渲染在快照面板的「周报」页签里需两步才可见；
   * 这里给出 1 次点击直达入口，聚焦到 insight 区块。
   */
  insightCount: number;
  /** 浏览器多选（Ctrl+Click）的标签数（≥2 时显示批量关闭入口）。 */
  highlightedCount: number;
  /** 撤销栈中可恢复的批次数量（>0 时护盾显示计数，强化「一切可反悔」的信任感）。 */
  undoBatchCount: number;
  /** 快照数量（>0 时快照按钮提示可恢复）。 */
  snapshotCount: number;
  /** 重排进行中：期间禁用入口防重复触发。 */
  quickRegrouping: boolean;
  /**
   * 批量操作（休眠全部 / 唤醒全部 / 清理重复）的在途态。
   * 非 idle 时禁用这三个入口 —— 唤醒全部要 reload N 个标签，耗时可达秒级，
   * 在途期间若不禁用且无提示，连点第二下会被静默丢弃。
   */
  batchBusy?: 'idle' | 'discard' | 'wake' | 'clean';
  onToggleAllSections: () => void;
  onDiscardInactive: () => void;
  onWakeAll: () => void;
  /** 重排临时区分组（打散现有分组后按当前方式重新归拢，可撤销）。 */
  onQuickRegroup: () => void;
  /** 一键清理重复标签（每网址保留「最近访问 > 激活 > 固定 > 位置靠前 > id 大」者，可撤销）。 */
  onCleanDuplicates: () => void;
  /** 关闭浏览器多选的标签（Ctrl+Click 选中后批量关闭）。 */
  onCloseHighlighted: () => void;
  onLocateActive: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  /** 打开关于页（能力总览 + 信任面板）：隐私自证的一次直达入口。 */
  onOpenAbout: () => void;
  onOpenSnapshots: () => void;
  /** 直达习惯洞察（打开快照面板并落在周报 / 洞察视图）。 */
  onOpenInsights: () => void;
  /** 底部工具区文字模式：开启后图标旁显示功能名称。 */
  footerLabels: boolean;
  onOpenPalette: () => void;
  /** 持久化的完整按钮顺序（`footer:` 前缀 id 列表）。 */
  footerOrder: readonly FooterButtonId[];
  /** 拖拽后的新顺序上抛（调用方负责持久化）。 */
  onReorderFooter: (order: FooterButtonId[]) => void;
}

export function FooterToolbar(props: FooterToolbarProps) {
  const { t } = useTranslation();
  const {
    tabCount,
    collapsibleCount,
    allCollapsed,
    activeTabId,
    discardedCount,
    sleepableCount,
    duplicateCount,
    insightCount,
    highlightedCount,
    undoBatchCount,
    snapshotCount,
    quickRegrouping,
    onToggleAllSections,
    onDiscardInactive,
    onWakeAll,
    onQuickRegroup,
    onCleanDuplicates,
    onCloseHighlighted,
    onLocateActive,
    onOpenHistory,
    onOpenSnapshots,
    onOpenInsights,
    onOpenSettings,
    onOpenAbout,
    onOpenPalette,
    footerLabels,
    footerOrder,
    onReorderFooter,
    batchBusy = 'idle'
  } = props;

  const order = footerOrder.map(footerButtonKeyFromId);

  /**
   * 拖拽结束写回顺序。
   *
   * 底栏共用全局 DndContext（在 DndRoot 内），因此这里用 useDndMonitor 监听而不是
   * 自己的 DndContext；只处理 `footer:` 前缀的拖拽，其余交给标签拖拽管线。
   */
  useDndMonitor({
    onDragEnd: (event) => {
      const activeId = String(event.active.id);
      if (!activeId.startsWith(FOOTER_ID_PREFIX)) return;
      const overId = event.over ? String(event.over.id) : undefined;
      if (!overId || !overId.startsWith(FOOTER_ID_PREFIX) || overId === activeId) return;
      const from = order.findIndex((key) => footerButtonId(key) === activeId);
      const to = order.findIndex((key) => footerButtonId(key) === overId);
      if (from < 0 || to < 0) return;
      onReorderFooter(arrayMove([...footerOrder], from, to));
    }
  });

  /**
   * 底栏按钮配置表：键与 `FOOTER_BUTTON_KEYS` 顺序表同构，漏登记由编译器兜住（Record 必须穷尽）。
   * `footerLabels ? t(...) : undefined` 的判定统一在渲染处做一次。
   *
   * `null` = 条件不满足，本次不渲染（位置仍留在顺序里，条件恢复后回到原位）。
   */
  const buttonSpecs: Record<FooterButtonKey, FooterButtonSpec | null> = {
    palette: {
      icon: Icons.shortcuts,
      label: t('打开命令面板'),
      text: t('命令'),
      onClick: onOpenPalette
    },
    locate: {
      icon: Icons.locate,
      label: t('定位当前标签'),
      text: t('定位'),
      disabled: activeTabId === undefined,
      onClick: onLocateActive
    },
    collapseAll: {
      icon: allCollapsed ? Icons.expandAll : Icons.collapseAll,
      label: t(allCollapsed ? '展开所有分组' : '收起所有分组'),
      text: t(allCollapsed ? '展开' : '折叠'),
      disabled: collapsibleCount === 0,
      onClick: onToggleAllSections
    },
    discard: {
      icon: Icons.snowflake,
      label:
        sleepableCount > 0
          ? t('休眠 {{count}} 个后台标签（释放内存）', { count: sleepableCount })
          : t('休眠全部后台标签（释放内存）'),
      text: t('休眠'),
      disabled: batchBusy !== 'idle',
      onClick: onDiscardInactive
    },
    wake:
      discardedCount > 0
        ? {
            icon: Icons.wakeAll,
            // 口径明示：这里只唤醒**当前窗口**的休眠标签（自动休眠的「全部唤醒」
            // 按台账 tabIds，可能跨窗口）。不写明会让用户以为一次唤醒所有窗口。
            label: t('唤醒当前窗口的 {{count}} 个休眠标签', { count: discardedCount }),
            text: t('唤醒'),
            disabled: batchBusy !== 'idle',
            onClick: onWakeAll
          }
        : null,
    snapshot: {
      icon: Icons.snapshot,
      label: t('快照'),
      text: t('快照'),
      badge: snapshotCount > 0 ? snapshotCount : undefined,
      onClick: onOpenSnapshots
    },
    history: {
      icon: Icons.history,
      label:
        undoBatchCount > 0
          ? t('本会话已可撤销 {{count}} 次：所有关闭操作都能撤销', { count: undoBatchCount })
          : t('撤销历史'),
      text: t('历史'),
      badge: undoBatchCount > 0 ? undoBatchCount : undefined,
      onClick: onOpenHistory
    },
    cleanDuplicates:
      duplicateCount > 0
        ? {
            icon: Icons.copyX,
            label: t('关闭重复标签：每个网址只留最近访问的一个；常驻磁贴与收藏夹条目豁免，可撤销'),
            text: t('清理重复'),
            badge: duplicateCount,
            disabled: batchBusy !== 'idle',
            onClick: onCleanDuplicates
          }
        : null,
    insights:
      insightCount > 0
        ? {
            icon: Icons.sparkles,
            label: t('查看 {{count}} 条习惯洞察（重复 / 休眠候选 / 滞留）', {
              count: insightCount
            }),
            text: t('洞察'),
            badge: insightCount,
            onClick: onOpenInsights
          }
        : null,
    // 多选不能只有视觉高亮而没有操作出口。
    closeHighlighted:
      highlightedCount >= 2
        ? {
            icon: Icons.close,
            label: t('关闭选中的 {{count}} 个标签', { count: highlightedCount }),
            text: t('关闭选中'),
            badge: highlightedCount,
            onClick: onCloseHighlighted
          }
        : null,
    regroup: {
      icon: Icons.quickRegroup,
      /* 原生 title 无换行、约 1s 才出现：38 字的整段会横向拖出极长一条，
         窄面板下溢出屏幕且没人读完。提示收敛到 8 字，完整说明在设置页。 */
      label: t('重排分组（自动存快照可回退）'),
      text: t('重排'),
      disabled: quickRegrouping,
      onClick: onQuickRegroup
    },
    // 信任面板：权限 → 用途映射与「自行验证零网络」教程。直达入口，
    // 不必走「设置页 → 关于页」三步。
    about: {
      icon: Icons.shield,
      label: t('查看能力总览'),
      text: t('关于'),
      onClick: onOpenAbout
    },
    // 不传 size="md"：底栏同排按钮均为 24px，唯独设置用 28/32px 会把整条底栏
    // 行高撑高、其余按钮上下各空 2px，视觉重心右偏。强调语义交给 tone="accent"。
    settings: {
      icon: Icons.settings,
      label: t('设置'),
      text: t('设置'),
      tone: 'accent',
      onClick: onOpenSettings
    }
  };

  /** 按 key 渲染按钮；条件不满足时返回 null。 */
  const renderFooterButton = (key: FooterButtonKey): ReactNode => {
    const spec = buttonSpecs[key];
    if (!spec) return null;
    return <IconButton {...spec} text={footerLabels ? spec.text : undefined} />;
  };

  return (
    // px-2 / py-1：与 .search-bar(4px 8px)、.add-tab-bar(4px 8px)、Toast(8px)
    // 同为 8px 内容竖线；原 px-2.5(10px) 让「共 N 个标签」比搜索图标右移 2px，
    // py-0.5(2px) 也让底栏比顶栏紧 2px。
    /* 左右布局：计数徽章居左（状态信息）、工具组居右（操作），两端分布。
       中间的空档是刻意的「呼吸区」—— 它把「这个窗口有多少标签」与「能做什么」
       分成两件事，符合工具条的信息层级。 */
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-gray-200 px-2 py-1 text-2xs text-gray-500">
      {/* 计数徽章：可见部分只显示数字，完整语义由 sr-only 与 title 中的本地化句子承载。 */}
      <span className="shrink-0" title={t('共 {{count}} 个标签', { count: tabCount })}>
        <span className="count-pill" aria-hidden="true">
          {tabCount}
        </span>
        <span className="sr-only">{t('共 {{count}} 个标签', { count: tabCount })}</span>
      </span>
      {/* gap-1：顺序可自定义（任意按钮可拖到任意位置），无法靠分隔线分组，用均匀间距表达「一组工具」。 */}
      <nav className="flex min-w-0 flex-wrap items-center gap-1" aria-label={t('侧边栏工具')}>
        {/* 按钮由 renderFooterButton 按 key 渲染、顺序来自 footerOrder：拖拽即改顺序
            （写回 settings.footerOrder）。条件不满足的按钮返回 null，自动跳过不占位。 */}
        <SortableContext items={order.map(footerButtonId)} strategy={horizontalListSortingStrategy}>
          {order.map((key) => {
            const node = renderFooterButton(key);
            return node === null ? null : (
              <SortableFooterButton key={key} id={footerButtonId(key)}>
                {node}
              </SortableFooterButton>
            );
          })}
        </SortableContext>
      </nav>
    </footer>
  );
}
