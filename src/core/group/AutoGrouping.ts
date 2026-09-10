import type { TemporarySection } from '@/core/site/Sections';
import { deriveSections } from '@/core/site/Sections';
import { subLabel } from '@/core/site/SiteGrouping';
import { siteResolver } from '@/core/site/SiteResolver';
import { domainToUnicode } from '@/core/url/punycode';
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
  /**
   * 吸收目标：已有原生组 id（同站点归并产生的分区携带，见 deriveSections）。
   * 设置时 tabIds 为要并入该组的未分组标签（同站点），不再新建组；
   * 不设置时按原语义新建原生组。
   */
  absorbIntoGroupId?: number;
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

/**
 * 语言分组 section（siteKey 形如 lang-en / lang-zh-CN / lang-unknown）。
 *
 * 语言 code 来自 tabs.detectLanguage（BCP-47，不含点），而真实站点的 siteKey
 * 是注册域字符串（必含点）——注册域以 lang- 开头的站点（如 lang-8.com）此前
 * 会被误判为语言分区。用「无点」排除域名形态，两个集合不再相交。
 */
function isLanguageSection(section: TemporarySection): boolean {
  return (
    section.kind === 'site' && section.siteKey.startsWith('lang-') && !section.siteKey.includes('.')
  );
}

/** 标签 URL 的站点展示标签（子域.注册域 / 裸注册域）；无法解析（非 web 页）返回 null。 */
function siteLabelOfTab(tab: TabRecord): string | null {
  const site = tab.url ? siteResolver.resolve(tab.url) : null;
  return site ? domainToUnicode(subLabel(site.subdomain, site.registrableDomain)) : null;
}

/**
 * 从展示 sections 推导自动分组计划。
 * 保守策略：
 *  - 未分组站点组照常新建原生组；
 *  - 同站点归并产生的分区（mergedGroupIds，见 deriveSections）：把与既有原生组
 *    同站点的未分组标签吸收进该组，收敛为"每站点一个原生组"——否则会为同一站点
 *    另建一个重复域名组（碎片化）；
 *  - 除此之外任一标签已入原生组则整组跳过（绝不并入用户手动分组）。
 */
export function planAutoGroups(sections: readonly TemporarySection[]): AutoGroupPlan[] {
  const plans: AutoGroupPlan[] = [];
  for (const section of sections) {
    if (section.kind !== 'site') continue;
    // site section 已满足聚合阈值（阈值 1 时单标签站点也成组），此处不再设下限；
    // 语言分组是兜底聚合（每种语言无条件成 section），单标签语言组没有组织意义，设下限 2。
    if (isLanguageSection(section) && section.tabs.length < 2) continue;

    const groupedTabs = section.tabs.filter((tab) => tab.groupId !== NO_GROUP);
    if (groupedTabs.length > 0) {
      // 仅处理"单一原生组且组内成员全部属于它"的归并分区；多组混入时无法安全吸收，跳过。
      const merged = section.mergedGroupIds;
      if (!merged || merged.length !== 1) continue;
      const targetGroupId = merged[0]!;
      if (groupedTabs.some((tab) => tab.groupId !== targetGroupId)) continue;
      // 吸收范围限于与既有组同站点的未分组标签（异子域标签保持未分组，由后续轮次处理）。
      const anchorLabel = siteLabelOfTab(groupedTabs[0]!);
      if (!anchorLabel) continue;
      const absorbTabIds = section.tabs
        .filter((tab) => tab.groupId === NO_GROUP && siteLabelOfTab(tab) === anchorLabel)
        .map((tab) => tab.id);
      if (absorbTabIds.length === 0) continue;
      plans.push({
        title: anchorLabel,
        color: groupColorForLabel(anchorLabel),
        tabIds: absorbTabIds,
        absorbIntoGroupId: targetGroupId
      });
      continue;
    }

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
