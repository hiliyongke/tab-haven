import { useTranslation } from '@/i18n';
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
    // flex-wrap 而非 overflow-x-auto：侧边栏最窄 300px，横向滚动会让整条面板
    // 溢出出横向滚动条；chip 换行为代价更小。左右 px-2 让首枚 chip 落在全局 8px 内容竖线。
    <div
      /* max-h-16 + 内滚：10 个工作区（含长名）换行后可占 140-160px，会把磁贴区、
         固定空间与主列表一起挤出首屏。两行封顶，超出在条内滚动。 */
      className="mb-2 flex max-h-16 shrink-0 flex-wrap items-center gap-1 overflow-y-auto overscroll-contain px-2"
      role="group"
      aria-label={t('工作区')}
      aria-busy={switching}
    >
      {activeSpaceId !== undefined && (
        <button
          type="button"
          aria-pressed={false}
          disabled={switching}
          title={t('全部标签')}
          onClick={onExit}
          className="chip chip--cjk rounded-full border border-gray-200 bg-surface px-2 py-1 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {t('全部标签')}
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
              'chip chip--cjk flex max-w-[140px] items-center gap-1 rounded-full border px-2 py-1 transition-colors disabled:opacity-50 ' +
              /* 激活态此前没有 hover 分支：鼠标悬停在已选工作区上零反馈 */
              (active
                ? 'border-accent-500 bg-accent-500 text-on-accent hover:bg-accent-600'
                : 'border-gray-200 bg-surface text-gray-600 hover:bg-gray-50')
            }
          >
            {/* 名称截断点：空间名由用户输入，无长度上限，不截断会把整条撑出横向滚动条 */}
            <span className="truncate">{space.name}</span>
            <span className="shrink-0 opacity-70">{space.tabCount}</span>
          </button>
        );
      })}
      <button
        type="button"
        disabled={switching}
        onClick={onSaveAs}
        className="chip chip--cjk flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-1 text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
      >
        <Icon d={Icons.plus} className="h-3 w-3" />
        {t('存为工作区')}
      </button>
    </div>
  );
}
