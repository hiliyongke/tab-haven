import type { Snapshot } from '@/core/schema/models';

/**
 * 快照来源徽标的唯一口径（文案键 + 配色）。
 *
 * 此前 `SnapshotRow` 与 `HistoryHitsSection` 各持一份映射表，复制时已经发生漂移：
 * 后者的「自动快照」用的是 `SnapshotRow` 注释里明确判定为**不达 WCAG AA**
 * （gray-500 在 gray-100 底上仅 3.92:1，gray-600 达 6.8:1，见 main.css
 * .count-pill 注释）的 `text-gray-500`。`check:ui` 只校验令牌是否越界/是否用了
 * 未受控调色板，不校验前景/背景组合的对比度，于是门禁绿灯放行了这次可达性回退。
 *
 * 收口到本模块后，新增来源类型或调整配色只有一处可改。
 */

interface SnapshotOriginBadge {
  /** 徽标文案的**中文原文**（属性名以 Key 结尾，是扫描器的抽取约定，见 i18n 工具包）。 */
  labelKey: string;
  /** 徽标配色（前景/背景组合须满足 WCAG AA）。 */
  className: string;
}

export function snapshotOriginBadge(origin: Snapshot['origin']): SnapshotOriginBadge {
  switch (origin) {
    case 'auto':
      return { labelKey: '自动快照', className: 'bg-gray-100 text-gray-600' };
    case 'archive':
      return { labelKey: '归档', className: 'bg-warn-100 text-warn-700' };
    case 'space':
      return { labelKey: '工作区', className: 'bg-accent-100 text-accent-700' };
    default:
      return { labelKey: '命名快照', className: 'bg-accent-50 text-accent-600' };
  }
}
