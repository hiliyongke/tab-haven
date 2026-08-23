import i18n from '@/i18n';
import { NO_GROUP, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import { aggregateBySite, type SiteSubGroup } from '@/core/site/SiteGrouping';

export type { SiteSubGroup } from '@/core/site/SiteGrouping';

/**
 * 临时区视图模型：把标签镜像派生为侧边栏可渲染的 section 列表。
 *
 * section 顺序（行为规格）：
 *   固定标签区（置顶）→ 原生标签组 → 网站聚合组 → 未分组。
 * 固定空间的排除（文件夹挂起/绑定）由 excludedTabIds 传入（数据层接入后填充）。
 */

export type TemporarySection =
  | { kind: 'pinned'; key: string; title: string; tabs: TabRecord[] }
  | {
      kind: 'native';
      key: string;
      title: string;
      tabs: TabRecord[];
      groupId: number;
      color?: string;
      collapsed: boolean;
      /** 来源树模式下按标签 id 记录的缩进层级。 */
      depths?: ReadonlyMap<number, number>;
    }
  | {
      kind: 'site';
      key: string;
      title: string;
      tabs: TabRecord[];
      siteKey: string;
      /** 多子域时的折叠子分组；单子域时为长度 0。 */
      subgroups: SiteSubGroup[];
      /** 来源树模式下按标签 id 记录的缩进层级。 */
      depths?: ReadonlyMap<number, number>;
    }
  | {
      kind: 'ungrouped';
      key: string;
      title: string;
      tabs: TabRecord[];
      /** 来源树模式下按标签 id 记录的缩进层级。 */
      depths?: ReadonlyMap<number, number>;
    };

interface SectionDerivation {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  /** 从临时区排除的标签（固定空间挂起/绑定、手动移出等）。 */
  excludedTabIds?: ReadonlySet<number>;
  /** 排序方式：browser 原生顺序 / recency 最近访问优先。 */
  sortMode?: 'browser' | 'recency';
  /** 非固定标签聚合模式：site 按网站 / opener 按来源树 / language 按语言。 */
  groupMode?: 'site' | 'opener' | 'language';
  /** 网站聚合成组阈值（同注册域达到该数量才成组），默认 2。 */
  threshold?: number;
}

/** 常见语言的 BCP-47 代码 → 展示名（其余回退为大写代码）。 */
const LANGUAGE_LABELS: Record<string, string> = {
  'zh-CN': '中文（简体）',
  'zh-TW': '中文（繁体）',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  ar: 'العربية',
  unknown: 'unknown'
};
function languageLabel(code: string): string {
  if (code === 'unknown') return i18n.t('sections.unknownLanguage');
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

/**
 * 由 openerTabId 构建来源树：把 opener 也在当前集合内的标签挂在父节点下，
 * 其余作为根（depth 0）。返回按 DFS 前序排列的标签与每层缩进深度。
 */
function buildOpenerTree(tabs: readonly TabRecord[]): {
  ordered: TabRecord[];
  depths: Map<number, number>;
} {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const childrenOf = new Map<number | undefined, TabRecord[]>();
  const pushChild = (parentId: number | undefined, tab: TabRecord) => {
    const list = childrenOf.get(parentId);
    if (list) list.push(tab);
    else childrenOf.set(parentId, [tab]);
  };
  for (const tab of tabs) {
    const opener = tab.openerTabId;
    const parent = opener !== undefined && byId.has(opener) ? opener : undefined;
    pushChild(parent, tab);
  }
  const ordered: TabRecord[] = [];
  const depths = new Map<number, number>();
  const visit = (parentId: number | undefined, depth: number) => {
    const children = (childrenOf.get(parentId) ?? []).sort((a, b) => a.index - b.index);
    for (const child of children) {
      depths.set(child.id, depth);
      ordered.push(child);
      visit(child.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return { ordered, depths };
}

export function deriveSections({
  tabs,
  groups,
  excludedTabIds,
  sortMode = 'browser',
  groupMode = 'site',
  threshold
}: SectionDerivation): TemporarySection[] {
  const excluded = excludedTabIds ?? new Set<number>();
  const sortCmp = (a: TabRecord | undefined, b: TabRecord | undefined): number =>
    sortMode === 'recency'
      ? (b?.lastAccessed ?? 0) - (a?.lastAccessed ?? 0)
      : (a?.index ?? 0) - (b?.index ?? 0);
  const sections: TemporarySection[] = [];

  // 固定标签区（置顶，独立成区，不混入原生组/站点组/未分组）。
  const pinnedTabs = tabs
    .filter((tab) => tab.pinned && !excluded.has(tab.id))
    .sort((a, b) => a.index - b.index);
  if (pinnedTabs.length > 0) {
    sections.push({
      kind: 'pinned',
      key: 'pinned',
      title: i18n.t('sections.pinned'),
      tabs: pinnedTabs
    });
  }

  // 原生标签组：组内标签按排序规则，排除绑定到固定空间的标签与固定标签。
  const groupsByFirstTab = groups
    .map((group) => ({
      group,
      groupTabs: tabs
        .filter(
          (tab) => !tab.pinned && tab.groupId === group.id && !excluded.has(tab.id)
        )
        .sort(sortCmp)
    }))
    .filter(({ groupTabs }) => groupTabs.length > 0)
    .sort((a, b) => sortCmp(a.groupTabs[0], b.groupTabs[0]));

  for (const { group, groupTabs } of groupsByFirstTab) {
    sections.push({
      kind: 'native',
      key: `group-${group.id}`,
      title: group.title || i18n.t('tabs.unnamedGroup'),
      tabs: groupTabs,
      groupId: group.id,
      color: group.color,
      collapsed: group.collapsed ?? false
    });
  }

  // 非固定、未分组标签（固定标签与原生组已单独分区）。
  const eligible = tabs
    .filter((tab) => !tab.pinned && tab.groupId === NO_GROUP && !excluded.has(tab.id))
    .sort(sortCmp);

  // 来源树模式：按 openerTabId 缩进成树。
  if (groupMode === 'opener') {
    const { ordered, depths } = buildOpenerTree(eligible);
    if (ordered.length > 0) {
      sections.push({
        kind: 'ungrouped',
        key: 'opener-tree',
        title: i18n.t('sections.openerTree'),
        tabs: ordered,
        depths
      });
    }
    return sections;
  }

  // 语言模式：按 detectLanguage 探测到的语言分组（无语言信息时归为 unknown）。
  if (groupMode === 'language') {
    const byLang = new Map<string, TabRecord[]>();
    const pushLang = (code: string, tab: TabRecord) => {
      const list = byLang.get(code);
      if (list) list.push(tab);
      else byLang.set(code, [tab]);
    };
    for (const tab of eligible) pushLang(tab.language || 'unknown', tab);
    for (const code of [...byLang.keys()].sort()) {
      sections.push({
        kind: 'site',
        key: `lang-${code}`,
        title: languageLabel(code),
        tabs: byLang.get(code) ?? [],
        siteKey: `lang-${code}`,
        subgroups: []
      });
    }
    return sections;
  }

  // 站点聚合 + 未分组（默认）。子域密度自动展开由 aggregateBySite 内部决定。
  const { groups: siteGroups, singles } = aggregateBySite(eligible, { threshold });

  for (const group of siteGroups) {
    // 多子域时标题用注册域（子域以 subgroups 折叠展示）；
    // 单子域时标题直接用子域标签，subgroups 为空保持扁平。
    const title =
      group.subgroups.length > 0 ? group.key.value : group.key.label;
    sections.push({
      kind: 'site',
      key: `site-${group.key.value}`,
      title,
      tabs: group.tabs,
      siteKey: group.key.value,
      subgroups: group.subgroups
    });
  }

  if (singles.length > 0) {
    sections.push({
      kind: 'ungrouped',
      key: 'ungrouped',
      title: i18n.t('tabs.ungrouped'),
      tabs: singles
    });
  }

  return sections;
}
