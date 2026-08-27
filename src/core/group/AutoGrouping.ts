import type { TemporarySection } from '@/core/site/Sections';
import { deriveSections } from '@/core/site/Sections';
import { NO_GROUP } from '@/core/tab-types';
import type { TabRecord } from '@/core/tab-types';

/**
 * 自动原生分组：把展示层聚合结果落成浏览器原生 tabGroups。
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
  const idx =
    ((Math.abs(hash) % GROUP_COLOR_NAMES.length) + GROUP_COLOR_NAMES.length) %
    GROUP_COLOR_NAMES.length;
  return GROUP_COLOR_NAMES[idx]!;
}

/** 语言分组 section（siteKey 形如 lang-en）：未经过站点阈值过滤，需自行设下限。 */
function isLanguageSection(section: TemporarySection): boolean {
  return section.kind === 'site' && section.siteKey.startsWith('lang-');
}

/**
 * 从展示 sections 推导自动分组计划。
 * 保守策略：任一标签已入原生组则整组跳过（绝不并入用户手动分组）。
 */
export function planAutoGroups(sections: readonly TemporarySection[]): AutoGroupPlan[] {
  const plans: AutoGroupPlan[] = [];
  for (const section of sections) {
    if (section.kind !== 'site') continue;
    // site section 已满足聚合阈值（阈值 1 时单标签站点也成组），此处不再设下限；
    // 语言分组是兜底聚合（每种语言无条件成 section），单标签语言组没有组织意义，设下限 2。
    if (isLanguageSection(section) && section.tabs.length < 2) continue;
    if (section.tabs.some((tab) => tab.groupId !== NO_GROUP)) continue;
    plans.push({
      title: section.title,
      color: groupColorForLabel(section.title),
      tabIds: section.tabs.map((tab) => tab.id)
    });
  }
  return plans;
}

export interface RegroupPlan {
  /** 需要移出现有原生组的标签（打散临时区旧分组；opener 模式仅打散不建组）。 */
  ungroupTabIds: number[];
  /** 重新聚合后的目标分组方案（site/language 模式非空，opener 模式为空）。 */
  plans: AutoGroupPlan[];
}

/**
 * 快速整理（完全重新初始化）决策：
 * 忽略当前分组状态，把临时区全部标签（已分组 + 未分组，排除固定区域）
 * 按当前聚合方式重新聚合。
 *  - 临时区定义：非固定标签（浏览器置顶/顶部固定磁贴不动）且不在固定空间绑定内；
 *  - 返回需要打散的标签（临时区内所有已在原生组的标签）；
 *  - 返回新分组方案（site/language 按聚合结果建组；opener 为层级结构，
 *    无法表达为原生组，plans 为空，仅完成打散）。
 */
export function planRegroup({
  tabs,
  excludedTabIds,
  groupMode,
  threshold
}: {
  tabs: readonly TabRecord[];
  excludedTabIds?: ReadonlySet<number>;
  groupMode?: 'site' | 'opener' | 'language';
  threshold?: number;
}): RegroupPlan {
  const excluded = excludedTabIds ?? new Set<number>();
  const tempTabs = tabs.filter((tab) => !tab.pinned && !excluded.has(tab.id));

  const ungroupTabIds = tempTabs.filter((tab) => tab.groupId !== NO_GROUP).map((tab) => tab.id);

  // 忽略当前分组状态重新聚合：把临时区标签全部视为「未分组」再派生。
  const normalized = tempTabs.map((tab) => ({ ...tab, groupId: NO_GROUP }));
  const sections = deriveSections({
    tabs: normalized,
    groups: [],
    excludedTabIds,
    groupMode,
    threshold
  });

  const plans: AutoGroupPlan[] = [];
  for (const section of sections) {
    if (section.kind !== 'site') continue;
    // 同上：site section 已满足聚合阈值，单标签站点（阈值 1）同样建组；
    // 语言分组同样设 ≥2 下限（单标签语言组不打散重建，保持未分组状态）。
    if (isLanguageSection(section) && section.tabs.length < 2) continue;
    plans.push({
      title: section.title,
      color: groupColorForLabel(section.title),
      tabIds: section.tabs.map((tab) => tab.id)
    });
  }

  return { ungroupTabIds, plans };
}
