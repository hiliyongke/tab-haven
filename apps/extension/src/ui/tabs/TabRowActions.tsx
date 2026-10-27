import { useTranslation } from '@/i18n';
import type { TabRecord } from '@/core/tab-types';
import { Icons } from '@/ui/common/Icon';
import { RowActionButton } from '@/ui/common/RowActionButton';
import { RowActions } from '@/ui/common/RowActions';

/**
 * 标签行尾的操作组（静音 / 固定 / 副本 / 休眠 / 关闭）。
 *
 * 从 `TabRow` 拆出的原因：它是纯渲染（五个按钮的条件组合），不含行的拖拽、
 * 滚动与菜单逻辑；行内以 memo 包裹后作为 `actions` 下传，拆出后 conditions 的
 * 改动不再牵动行组件本体。
 *
 * 每个按钮的可见条件都对应一条真实约束（静音只在有声时出现、休眠不作用于
 * 当前激活标签），改动前先确认条件来源。
 */
export function TabRowActions({
  tab,
  rowActionsVisible,
  onToggleMute,
  onTogglePin,
  onDuplicate,
  onDiscard,
  onClose
}: {
  tab: TabRecord;
  rowActionsVisible: boolean;
  onToggleMute: (tab: TabRecord) => void;
  onTogglePin: (tab: TabRecord) => void;
  onDuplicate?: (tab: TabRecord) => void;
  onDiscard?: (tab: TabRecord) => void;
  onClose: (tab: TabRecord) => void;
}) {
  const { t } = useTranslation();
  return (
    <RowActions forceVisible={rowActionsVisible}>
      {(tab.audible || tab.muted) && (
        <RowActionButton
          icon={tab.muted ? Icons.volumeOff : Icons.volumeOn}
          label={tab.muted ? t('取消静音') : t('静音')}
          onClick={() => onToggleMute(tab)}
        />
      )}
      <RowActionButton
        icon={Icons.pin}
        label={tab.pinned ? t('取消固定') : t('固定到浏览器标签栏（置顶）')}
        /* 已固定的行内按钮保持强调色：它是「当前状态」而非一次性动作。 */
        iconClass={'h-3.5 w-3.5' + (tab.pinned ? ' text-accent-500' : '')}
        onClick={() => onTogglePin(tab)}
      />
      {onDuplicate && (
        <RowActionButton icon={Icons.copy} label={t('打开副本')} onClick={() => onDuplicate(tab)} />
      )}
      {onDiscard && !tab.discarded && !tab.active && (
        <RowActionButton
          icon={Icons.snowflake}
          label={t('休眠标签（释放内存）')}
          onClick={() => onDiscard(tab)}
        />
      )}
      <RowActionButton
        icon={Icons.close}
        label={t('关闭标签')}
        danger
        onClick={() => onClose(tab)}
      />
    </RowActions>
  );
}
