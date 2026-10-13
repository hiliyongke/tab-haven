import { Slot, Trans, useTranslation } from '@/i18n';
import { IconButton } from '@/ui/common/IconButton';
import { Icons } from '@/ui/common/Icon';

/**
 * 底部工具区：标签计数 + 三组快捷功能（视图组织 / 内存管理 / 记录恢复）+ 设置。
 * 从 sidepanel App 拆出，保持渲染层纯粹（逻辑由回调注入）。
 */
export interface FooterToolbarProps {
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
   * F-1：洞察此前只渲染在快照面板的「周报」页签里，需两步才可见；
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
   * 此前在途期间按钮既不禁用也无提示，连点第二下被静默丢弃。
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
}

/** 功能组之间的细分隔线（与设置前的分隔线同款，帮助用户按组理解图标语义）。 */
function GroupDivider() {
  // 间距交给 nav 的 gap 提供（此前 mx-0.5 在窄面板会把图标行挤到换行）。
  return <span className="h-3.5 w-px shrink-0 bg-gray-200" aria-hidden="true" />;
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
    batchBusy = 'idle'
  } = props;

  return (
    // px-2 / py-1：与 .search-bar(4px 8px)、.add-tab-bar(4px 8px)、Toast(8px)
    // 同为 8px 内容竖线；原 px-2.5(10px) 让「共 N 个标签」比搜索图标右移 2px，
    // py-0.5(2px) 也让底栏比顶栏紧 2px。
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-gray-200 px-2 py-1 text-2xs text-gray-500">
      {/* 整句化而非拼接：`t('共 ')` + 数量的写法在英文里是「空串 + 数字」，
          而数量仍要加粗 —— 走 <Trans> + <Slot> 让整句进词典、数字保留强调。 */}
      <span className="whitespace-nowrap">
        <Trans>
          共 <Slot content={<strong>{tabCount}</strong>} /> 个标签
        </Trans>
      </span>
      <nav className="flex min-w-0 flex-wrap items-center gap-0.5" aria-label={t('侧边栏工具')}>
        {/* 组 1 · 视图与组织：命令面板 / 折叠全部 / 快速整理 / 定位 */}
        <IconButton
          icon={Icons.shortcuts}
          title={t('打开命令面板')}
          label={footerLabels ? t('命令') : undefined}
          onClick={onOpenPalette}
        />
        <IconButton
          icon={allCollapsed ? Icons.expandAll : Icons.collapseAll}
          title={t(allCollapsed ? '展开所有分组' : '收起所有分组')}
          label={footerLabels ? t(allCollapsed ? '展开' : '折叠') : undefined}
          disabled={collapsibleCount === 0}
          onClick={onToggleAllSections}
        />
        {/* 重排分组：分组乱了之后唯一的一键修复入口 ——
            虽然低频，但价值不可替代（曾被下沉到命令面板，用户要求恢复常驻）。 */}
        <IconButton
          icon={Icons.quickRegroup}
          title={t(
            '打散当前分组并按当前聚合方式重排；执行前自动存一份快照可回退（保存失败则取消重排）'
          )}
          label={footerLabels ? t('重排') : undefined}
          disabled={quickRegrouping}
          onClick={onQuickRegroup}
        />
        <IconButton
          icon={Icons.locate}
          title={t('定位当前标签')}
          label={footerLabels ? t('定位') : undefined}
          disabled={activeTabId === undefined}
          onClick={onLocateActive}
        />
        {/* 清理重复：仅在存在可清理项时出现（与「唤醒全部」同款条件出现模式），
            徽章直接显示待清理数量，点按即清理并进撤销栈。 */}
        {duplicateCount > 0 && (
          <IconButton
            icon={Icons.copyX}
            title={t(
              '关闭重复标签：每个网址只留最近访问的一个；常驻磁贴与固定空间条目豁免，可撤销'
            )}
            label={footerLabels ? t('清理重复') : undefined}
            badge={duplicateCount}
            disabled={batchBusy !== 'idle'}
            onClick={onCleanDuplicates}
          />
        )}
        {/* 习惯洞察入口（R16 / F-1）：有洞察项时出现。
            此前洞察只存在于快照面板的「周报」页签里 —— 用户要先打开快照面板、
            再切页签才能看到，等于没有入口。这里让「清理重复 / 休眠」这两个
            与洞察直接对应的动作旁边就有直达入口。 */}
        {insightCount > 0 && (
          <IconButton
            icon={Icons.sparkles}
            title={t('查看 {{count}} 条习惯洞察（重复 / 休眠候选 / 滞留）', {
              count: insightCount
            })}
            label={footerLabels ? t('洞察') : undefined}
            badge={insightCount}
            onClick={onOpenInsights}
          />
        )}
        {/* 关闭选中的标签：浏览器 Ctrl+Click 多选 ≥2 个时出现 ——
            此前多选只有视觉高亮、没有操作出口（半成品承诺）。 */}
        {highlightedCount >= 2 && (
          <IconButton
            icon={Icons.close}
            title={t('关闭选中的 {{count}} 个标签', { count: highlightedCount })}
            label={footerLabels ? t('关闭选中') : undefined}
            badge={highlightedCount}
            onClick={onCloseHighlighted}
          />
        )}
        <GroupDivider />
        {/* 组 2 · 内存管理：休眠全部 / 唤醒全部（条件出现） */}
        <IconButton
          icon={Icons.snowflake}
          title={
            sleepableCount > 0
              ? t('休眠 {{count}} 个后台标签（释放内存）', { count: sleepableCount })
              : t('休眠全部后台标签（释放内存）')
          }
          label={footerLabels ? t('休眠') : undefined}
          disabled={batchBusy !== 'idle'}
          onClick={onDiscardInactive}
        />
        {discardedCount > 0 && (
          <IconButton
            icon={Icons.wakeAll}
            // 口径明示：这里只唤醒**当前窗口**的休眠标签（自动休眠的「全部唤醒」
            // 按台账 tabIds，可能跨窗口）。不写明会让用户以为一次唤醒所有窗口。
            title={t('唤醒当前窗口的 {{count}} 个休眠标签', { count: discardedCount })}
            label={footerLabels ? t('唤醒') : undefined}
            disabled={batchBusy !== 'idle'}
            onClick={onWakeAll}
          />
        )}
        <GroupDivider />
        {/* 组 3 · 记录与恢复：快照空间 / 撤销历史（均带计数徽章） */}
        <IconButton
          icon={Icons.snapshot}
          title={t('快照')}
          label={footerLabels ? t('快照') : undefined}
          badge={snapshotCount > 0 ? snapshotCount : undefined}
          onClick={onOpenSnapshots}
        />
        <IconButton
          icon={Icons.history}
          title={
            undoBatchCount > 0
              ? t('本会话已可撤销 {{count}} 次：所有关闭操作都能撤销', { count: undoBatchCount })
              : t('撤销历史')
          }
          label={footerLabels ? t('历史') : undefined}
          badge={undoBatchCount > 0 ? undoBatchCount : undefined}
          onClick={onOpenHistory}
        />
        {/* 信任面板（P-03）：权限 → 用途映射与「自行验证零网络」教程。
            此前唯一入口是「设置页 → 关于页」，核心卖点却要三步才摸得到。 */}
        <IconButton
          icon={Icons.shield}
          title={t('查看能力总览')}
          label={footerLabels ? t('关于') : undefined}
          onClick={onOpenAbout}
        />
        <GroupDivider />
        {/* 不传 box="md"：底栏同排 12 个按钮均为 24px，唯独设置用 28/32px 会把
            整条底栏行高撑高、其余按钮上下各空 2px，视觉重心右偏。
            强调语义交给 tone="accent"，不靠尺寸。 */}
        <IconButton
          icon={Icons.settings}
          title={t('设置')}
          label={footerLabels ? t('设置') : undefined}
          tone="accent"
          onClick={onOpenSettings}
        />
      </nav>
    </footer>
  );
}
