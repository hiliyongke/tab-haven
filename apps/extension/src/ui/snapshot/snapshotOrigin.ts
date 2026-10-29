import type { Snapshot } from '@/core/schema/models';
import type { ChipTone } from '@/ui/common/Chip';

/**
 * 快照来源徽标的唯一口径（文案键 + 色调）。
 *
 * 配色交给 `Chip` 的 `ChipTone` 统一：前景/背景组合须满足 WCAG AA
 * （gray-500 在 gray-100 底上仅 3.92:1，不达标；check:ui 不校验组合对比度）。
 */

interface SnapshotOriginBadge {
  /** 徽标文案的中文原文（属性名以 Key 结尾，是扫描器的抽取约定，见 i18n 工具包）。 */
  labelKey: string;
  /** 徽标色调（前景/背景组合须满足 WCAG AA，组合由 Chip 统一）。 */
  tone: ChipTone;
}

export function snapshotOriginBadge(origin: Snapshot['origin']): SnapshotOriginBadge {
  switch (origin) {
    case 'auto':
      return { labelKey: '自动快照', tone: 'neutral' };
    case 'archive':
      return { labelKey: '归档', tone: 'warn' };
    case 'space':
      return { labelKey: '工作区', tone: 'accent' };
    default:
      return { labelKey: '命名快照', tone: 'brand' };
  }
}
