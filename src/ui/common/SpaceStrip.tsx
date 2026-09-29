import { useTranslation } from 'react-i18next';
import type { Snapshot } from '@/core/schema/models';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 工作空间切换条（C1）：搜索栏下方的横向 chip 列表。
 *
 * 无任何空间快照时整条隐藏（不占位、不打扰既有布局）；第一个空间由
 * 命令面板的「保存为空间」或本条目的「存为空间」创建。
 * chips 是 toggle 语义（aria-pressed），激活态用品牌绿实底；
 * 有激活空间时首项固定为「全部标签」出口——只给进不给退会让用户困在
 * 某个空间里（唯一的退路原本是删掉该空间快照）。
 */
export function SpaceStrip({
  spaces,
  activeSpaceId,
  switching,
  onSwitch,
  onExit,
  onSaveAs
}: {
  spaces: readonly Snapshot[];
  activeSpaceId: string | undefined;
  /** 切换在途：禁用全部入口并标记 busy（编排含多段 await，连点会并发）。 */
  switching: boolean;
  onSwitch: (space: Snapshot) => void;
  /** 退出空间回到「全部标签」态。 */
  onExit: () => void;
  onSaveAs: () => void;
}) {
  const { t } = useTranslation();
  if (spaces.length === 0) return null;
  return (
    <div
      className="mb-2.5 flex shrink-0 items-center gap-1 overflow-x-auto px-1"
      role="group"
      aria-label={t('spaces.stripLabel')}
      aria-busy={switching}
    >
      {activeSpaceId !== undefined && (
        <button
          type="button"
          aria-pressed={false}
          disabled={switching}
          title={t('spaces.allTabs')}
          onClick={onExit}
          className="shrink-0 rounded-full border border-gray-200 bg-surface px-2.5 py-1 text-3xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {t('spaces.allTabs')}
        </button>
      )}
      {spaces.map((space) => {
        const active = space.id === activeSpaceId;
        return (
          <button
            key={space.id}
            type="button"
            aria-pressed={active}
            disabled={switching}
            title={space.name}
            onClick={() => onSwitch(space)}
            className={
              'shrink-0 rounded-full border px-2.5 py-1 text-3xs transition-colors disabled:opacity-50 ' +
              (active
                ? 'border-accent-500 bg-accent-500 font-medium text-on-accent'
                : 'border-gray-200 bg-surface text-gray-600 hover:bg-gray-50')
            }
          >
            {space.name}
            <span className="ml-1 opacity-70">{space.tabCount}</span>
          </button>
        );
      })}
      <button
        type="button"
        disabled={switching}
        onClick={onSaveAs}
        className="flex shrink-0 items-center gap-0.5 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-3xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
      >
        <Icon d={Icons.plus} className="h-3 w-3" />
        {t('spaces.saveAs')}
      </button>
    </div>
  );
}
