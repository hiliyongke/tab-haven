import { useRef } from 'react';
import { useTranslation } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { Icon, Icons } from '@/ui/common/Icon';
import { SegmentedChip } from '@/ui/common/SegmentedChip';
import { useScrollFade } from '@/ui/common/useScrollFade';

/**
 * 工作区切换条（C1）：搜索栏下方的横向 chip 列表。
 *
 * 无任何空间快照时整条隐藏（不占位、不打扰既有布局）；第一个空间由
 * 命令面板的「保存为空间」或本条目的「存为空间」创建。
 * chips 是 toggle 语义（aria-pressed），激活态用品牌绿实底；
 * 有激活空间时首项固定为「全部标签」出口——只给进不给退会让用户困在
 * 某个空间里（否则唯一的退路是删掉该空间快照）。
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
  // 两行封顶 + 内滚：滚到底必须有渐隐提示，否则用户不知道下面还有工作区。
  const listRef = useRef<HTMLDivElement>(null);
  useScrollFade(listRef, spaces.length);
  if (spaces.length === 0) return null;
  return (
    // flex-wrap 而非 overflow-x-auto：侧边栏最窄 300px，横向滚动会让整条面板
    // 溢出出横向滚动条；chip 换行为代价更小。左右 px-2 让首枚 chip 落在全局 8px 内容竖线。
    <div
      /* max-h-16 + 内滚：10 个工作区（含长名）换行后可占 140-160px，会把磁贴区、
         固定空间与主列表一起挤出首屏。两行封顶，超出在条内滚动。 */
      ref={listRef}
      // max-h 精确到两行（22px chip × 2 + gap 4 ≈ 48px，留 4px 余量）：
      // 64px 会把第三行裁成半颗胶囊 —— 比「直接隐藏」或「完整滚动」都难看。
      className="scroll-fade mb-2 flex max-h-[52px] shrink-0 flex-wrap items-center gap-1 overflow-y-auto overscroll-contain px-2"
      role="group"
      aria-label={t('工作区')}
      aria-busy={switching}
    >
      {/* 「全部标签」常驻并参与激活态：若它只在激活了某个工作区时才出现，那么
          「存了 3 个工作区但当前不在任何一个里」时界面上是 N 个全部未高亮的 chip、
          没有任何文字标识当前视图范围 —— 用户无法回答「我现在看到的是哪个范围」。
          未激活时它就是激活项（exitSpace 对未激活态是空操作，安全）。 */}
      <SegmentedChip
        shape="pill"
        tone="brand"
        selected={activeSpaceId === undefined}
        disabled={switching}
        tooltip={t('全部标签')}
        onSelect={onExit}
      >
        {t('全部标签')}
      </SegmentedChip>
      {spaces.map((space) => {
        const active = space.id === activeSpaceId;
        return (
          <SegmentedChip
            key={space.id}
            shape="pill"
            tone="brand"
            selected={active}
            disabled={switching}
            tooltip={space.name}
            className="flex max-w-[140px] items-center gap-1"
            onSelect={() => onSwitch(space)}
          >
            {/* 名称截断点：空间名由用户输入，无长度上限，不截断会把整条撑出横向滚动条 */}
            <span className="truncate">{space.name}</span>
            {/* 裸数字 + 70% 透明：低视力下不足 3:1，读屏听到孤立量词「12」。
                与 SectionHead 同口径：可见数字对读屏隐藏，改播完整语义。 */}
            <span className="shrink-0 text-gray-500" aria-hidden="true">
              {space.tabCount}
            </span>
            <span className="sr-only">{t('共 {{count}} 个标签', { count: space.tabCount })}</span>
          </SegmentedChip>
        );
      })}
      {/* 一次性入口（不是开关）：不传 selected，避免落 aria-pressed 误导。 */}
      <SegmentedChip
        shape="pill"
        disabled={switching}
        className="flex items-center gap-1 border-dashed border-control"
        onSelect={onSaveAs}
      >
        <Icon d={Icons.plus} className="h-3 w-3" />
        {t('存为工作区')}
      </SegmentedChip>
    </div>
  );
}
