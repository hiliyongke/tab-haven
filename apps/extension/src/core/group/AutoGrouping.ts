import { MIN_LANGUAGE_GROUP_SIZE, parseLangSiteKey } from '@/core/site/Sections';
import type { TemporarySection } from '@/core/site/Sections';
import { deriveSections } from '@/core/site/Sections';
import { siteLabelOf } from '@/core/site/SiteKey';
import { siteResolver } from '@/core/site/SiteResolver';
import { AUTO_GROUP_COLOR_NAMES } from '@/core/group/groupColors';
import { hash31 } from '@/core/util/hash';
import { NO_GROUP } from '@/core/tab-types';
import type { TabRecord } from '@/core/tab-types';

/**
 * 自动原生分组：把展示层 site section 落成浏览器原生 tabGroups。
 * 纯决策层，不触碰 browser.*；只创建不自动解散；opener 模式无法表达为原生组。
 */
export interface AutoGroupPlan {
  /** 组标题（域名 / 语言标签）。 */
  title: string;
  /** Chrome 组色枚举。 */
  color: string;
  tabIds: number[];
  /** 设置时把 tabIds 并入该既有组（同站点归并），否则新建组。 */
  absorbIntoGroupId?: number;
}

/** 标签 → 稳定的 8 色枚举（同一标题永远同色，避开灰色）。 */
export function groupColorForLabel(label: string): string {
  const hash = hash31(label);
  const index =
    ((Math.abs(hash) % AUTO_GROUP_COLOR_NAMES.length) + AUTO_GROUP_COLOR_NAMES.length) %
    AUTO_GROUP_COLOR_NAMES.length;
  return AUTO_GROUP_COLOR_NAMES[index]!;
}

/** siteKey 的构造与反解口径统一在 parseLangSiteKey，此处不重写字符串判定。 */
function isLanguageSection(section: TemporarySection): boolean {
  return section.kind === 'site' && parseLangSiteKey(section.siteKey) !== undefined;
}

/** 站点展示标签；url 为空回退 pendingUrl（新标签导航早期只有 pendingUrl）。用 siteLabelOf 保端口，与聚合口径一致。 */
function siteLabelOfTab(tab: TabRecord): string | null {
  const rawUrl = tab.url || tab.pendingUrl;
  const site = rawUrl ? siteResolver.resolve(rawUrl) : null;
  return site ? siteLabelOf(site) : null;
}

/**
 * 从展示 sections 推导自动分组计划。
 * 保守策略：同站点归并分区把未分组标签吸收进既有组；其余任何标签已入原生组则整组跳过
 * （绝不打扰用户手动分组）。
 */
export function planAutoGroups(sections: readonly TemporarySection[]): AutoGroupPlan[] {
  const plans: AutoGroupPlan[] = [];
  for (const section of sections) {
    if (section.kind !== 'site') continue;
    // 语言分组是兜底聚合，单标签无组织意义，设下限 2。
    if (isLanguageSection(section) && section.tabs.length < MIN_LANGUAGE_GROUP_SIZE) continue;

    const groupedTabs = section.tabs.filter((tab) => tab.groupId !== NO_GROUP);
    if (groupedTabs.length > 0) {
      // 仅「单一原生组且成员全部属于它」可安全吸收；不用 `merged[0]!`（上游放宽长度时会得到 undefined 组 id）。
      const targetGroupId =
        section.mergedGroupIds?.length === 1 ? section.mergedGroupIds[0] : undefined;
      if (targetGroupId === undefined) continue;
      if (groupedTabs.some((tab) => tab.groupId !== targetGroupId)) continue;
      // 吸收范围限同站点未分组标签（异子域留待后续轮次）。
      const anchorTab = groupedTabs[0];
      if (!anchorTab) continue;
      const anchorLabel = siteLabelOfTab(anchorTab);
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

    // 只收 groupId === NO_GROUP 的标签：groupId 未知的标签可能已属浏览器侧某组，为它建组会覆盖既有归属。
    const ungroupedTabIds = section.tabs
      .filter((tab) => tab.groupId === NO_GROUP)
      .map((tab) => tab.id);
    if (ungroupedTabIds.length === 0) continue;
    plans.push({
      title: section.title,
      color: groupColorForLabel(section.title),
      tabIds: ungroupedTabIds
    });
  }
  return plans;
}

/** 自动组内「域名漂移」成员校正：需要移出组的标签。 */
interface AutoGroupDomainCorrection {
  /** 自动组 id（仅限本功能创建、记录在案的组）。 */
  groupId: number;
  /** 组标题，供调用方留痕排查。 */
  title: string;
  /** 组内 URL 已不属于该域名的标签 id。 */
  tabIds: number[];
}

/**
 * 自动组「域名漂移」校正：从组内标签点开的跨域新标签会被 Chrome 自动加入同组，
 * 需按域名锚点识别并移出。只处理 autoGroupIds 内的组；用户手动组一律不动。
 */
export function planAutoGroupDomainCorrections(
  sections: readonly TemporarySection[],
  autoGroupIds: ReadonlySet<number>
): AutoGroupDomainCorrection[] {
  if (autoGroupIds.size === 0) return [];
  const corrections: AutoGroupDomainCorrection[] = [];
  for (const section of sections) {
    if (section.kind !== 'native') continue;
    if (!autoGroupIds.has(section.groupId)) continue;
    let hasAnchor = false;
    const drifted: number[] = [];
    for (const tab of section.tabs) {
      // 组内必须有「域名 === 组标题」的锚点，证明该组身份；否则（改名/成员全离开）跳过。
      const rawUrl = tab.url || tab.pendingUrl;
      const site = rawUrl ? siteResolver.resolve(rawUrl) : null;
      if (!site) continue;
      if (siteLabelOf(site) === section.title) {
        hasAnchor = true;
        continue;
      }
      drifted.push(tab.id);
    }
    if (!hasAnchor || drifted.length === 0) continue;
    corrections.push({ groupId: section.groupId, title: section.title, tabIds: drifted });
  }
  return corrections;
}

/** 快速整理的执行方案：先打散哪些组，再按什么方案重建。 */
interface RegroupPlan {
  /** 需移出现有原生组的标签（opener 模式仅打散不建组）。 */
  ungroupTabIds: number[];
  /** 重新聚合的目标方案（site/language 非空；opener 为层级结构，plans 为空）。 */
  plans: AutoGroupPlan[];
}

/** 忽略当前分组状态，把临时区全部标签重新聚合：返回需打散的 id 与新分组方案。 */
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
    // 单标签语言组不打散重建，保持未分组。
    if (isLanguageSection(section) && section.tabs.length < MIN_LANGUAGE_GROUP_SIZE) continue;
    plans.push({
      title: section.title,
      color: groupColorForLabel(section.title),
      tabIds: section.tabs.map((tab) => tab.id)
    });
  }

  return { ungroupTabIds, plans };
}
