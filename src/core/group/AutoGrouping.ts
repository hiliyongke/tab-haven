import type { TemporarySection } from '@/core/site/Sections';
import { NO_GROUP } from '@/core/tab-types';

/**
 * 自动原生分组（FR-D3.1 扩展）：把展示层聚合结果落成浏览器原生 tabGroups。
 *
 * 纯决策层，不触碰 browser.*：
 *  - 只处理 kind === 'site' 的 section（网站聚合 / 语言分组）；
 *  - 防御性跳过已入原生组的标签（正常流程 deriveSections 已隔离未分组标签，
 *    此处兜底保证绝不打扰用户手动建立的分组）；
 *  - 幂等：创建成功后标签获得 groupId，下一轮快照不再产出 plan。
 *
 * 行为约束（与 PRD「自动分组不写回浏览器」的取舍）：
 *  - 只创建、不自动解散：关闭开关不会解散已创建的组（用户手动管理）；
 *  - 来源树模式（opener）无法表达为原生组，调用方应跳过。
 */

/** 浏览器原生组色枚举（Chrome tabGroups，grey 保留给用户手动场景）。 */
const GROUP_COLOR_NAMES = [
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
] as const;

export interface AutoGroupPlan {
  /** 组标题（域名 / 语言标签）。 */
  title: string;
  /** Chrome 组色枚举。 */
  color: string;
  tabIds: number[];
}

/** 标签 → 稳定的 8 色枚举（同一标题永远同色，且避开灰色）。 */
export function groupColorForLabel(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  const idx = ((Math.abs(hash) % GROUP_COLOR_NAMES.length) + GROUP_COLOR_NAMES.length) %
    GROUP_COLOR_NAMES.length;
  return GROUP_COLOR_NAMES[idx]!;
}

/**
 * 从展示 sections 推导自动分组计划。
 * 保守策略：任一标签已入原生组则整组跳过（绝不并入用户手动分组）。
 */
export function planAutoGroups(sections: readonly TemporarySection[]): AutoGroupPlan[] {
  const plans: AutoGroupPlan[] = [];
  for (const section of sections) {
    if (section.kind !== 'site') continue;
    if (section.tabs.length < 2) continue;
    if (section.tabs.some((tab) => tab.groupId !== NO_GROUP)) continue;
    plans.push({
      title: section.title,
      color: groupColorForLabel(section.title),
      tabIds: section.tabs.map((tab) => tab.id)
    });
  }
  return plans;
}
