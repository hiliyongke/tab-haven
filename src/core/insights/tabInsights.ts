import type { TabRecord } from '@/core/tab-types';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { normalizeHostname } from '@/core/url/hostname';

/**
 * 标签习惯洞察（P-05）：从本地标签数据推导三类行动建议。
 *
 * 全部纯本地计算，零上报 —— 与竞品「云端洞察」相对的「隐私 Insight」。
 * 三类洞察的出口全部指向产品内已有动作（清理重复 / 一键休眠 / 归档窗口），
 * 形成「发现 → 行动」闭环。洞察对象是「当前窗口快照」，随事件刷新，不落盘。
 *
 * 设计约束（与产品分析报告 3.1 场景缺口表对齐）：
 *  - 重复重灾区：哪些站点在窗口里持有最多冗余标签（同一页面 ≥ 2 份）；
 *  - 休眠候选：可安全休眠（canSafelyDiscardTab）且未被固定空间绑定的标签；
 *  - 滞留预警：打开超过 7 天未激活的标签 → 建议归档。
 */

/** 重复重灾区阈值：同页面份数 ≥ 2 记为重复（与 DuplicateIndex 口径一致）。 */
const DUPLICATE_THRESHOLD = 2;

/** 滞留预警阈值：7 天未激活（ms）。 */
export const STALE_TAB_DAYS = 7;
export const STALE_TAB_MS = STALE_TAB_DAYS * 24 * 3600 * 1000;

/** 每类洞察的 Top N 上限（防面板溢出，计算保持 O(n log n)）。 */
export const INSIGHT_TOP_N = 5;

/** 重复重灾区条目。 */
export interface DuplicateHotspot {
  /** 站点域名（归一化：小写、去 www、去尾点）。 */
  host: string;
  /** 冗余标签数（该页面的全部份数）。 */
  count: number;
}

/** 滞留标签条目。 */
export interface StaleTab {
  id: number;
  /** 标题（空则回退 URL）。 */
  label: string;
  /** 滞留整天数（向下取整）。 */
  days: number;
}

/** 窗口洞察汇总。 */
export interface InsightsResult {
  /** 重复重灾区（按冗余份数降序、域名稳定序，Top N）。 */
  duplicateHotspots: DuplicateHotspot[];
  /** 可安全休眠标签数（未激活、未固定、未播放、非绑定）。 */
  discardableCount: number;
  /** 滞留标签（按滞留时长降序，Top N）。 */
  staleTabs: StaleTab[];
  /** 已休眠标签数（供「休眠收益」区展示当前状态）。 */
  discardedCount: number;
}

/**
 * 洞察版页面身份键：归一化主机名 + 路径 + 查询 + 片段。
 *
 * 比 webComparisonKey（复用引擎 / DuplicateIndex 的严格口径）宽松一档——
 * 主机名经 www 归一化，www.a.com/x 与 a.com/x 记同一页面：洞察按站点聚合
 * 展示，用户认知里「带不带 www」不是两个页面。严格口径服务于自动清理的
 * 误杀防线（宁漏勿杀），宽松口径服务于「重灾区」的完整呈现，两者刻意不同。
 * pendingUrl 优先与复用引擎同序（导航中的标签以目标页身份参与统计）。
 */
function pageKeyOf(tab: TabRecord): { key: string; host: string } | null {
  const candidates = tab.pendingUrl ? [tab.pendingUrl, tab.url] : [tab.url];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      const host = normalizeHostname(parsed.hostname);
      if (!host) continue;
      return { key: `${host}${parsed.pathname}${parsed.search}${parsed.hash}`, host };
    } catch {
      // 不可解析（内部页 / 空串）：尝试下一候选
    }
  }
  return null;
}

/**
 * 计算窗口洞察。
 * @param tabs 当前窗口标签快照（tabStore.tabs）
 * @param boundTabIds 固定空间绑定标签 id 集合（绑定标签不参与休眠建议，
 *   与 handleDiscardInactive 的 targets 过滤口径一致）
 * @param now 滞留判定的时间基准；默认 Date.now()，测试注入固定值保持
 *   确定性 —— 与 parseWorkona 的 fallbackTime 注入同款惯例
 */
export function computeInsights(
  tabs: readonly TabRecord[],
  boundTabIds: ReadonlySet<number>,
  now: number = Date.now()
): InsightsResult {
  // 1) 重复重灾区：页面身份键分组（www 归一化口径），≥ 2 份成组；
  //    组内取归一化域名，同域名多组合并计数（一个站点多页面重复时按站点聚合更可读）。
  const countByHost = new Map<string, number>();
  const copiesByKey = new Map<string, number>();
  for (const tab of tabs) {
    const identity = pageKeyOf(tab);
    if (!identity) continue;
    const copies = copiesByKey.get(identity.key) ?? 0;
    copiesByKey.set(identity.key, copies + 1);
    if (copies + 1 === DUPLICATE_THRESHOLD) {
      // 该页面第二次出现：前一份 + 当前这份都记入站点冗余计数
      countByHost.set(identity.host, (countByHost.get(identity.host) ?? 0) + DUPLICATE_THRESHOLD);
    } else if (copies + 1 > DUPLICATE_THRESHOLD) {
      countByHost.set(identity.host, (countByHost.get(identity.host) ?? 0) + 1);
    }
  }
  const duplicateHotspots = [...countByHost.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .slice(0, INSIGHT_TOP_N);

  // 2) 休眠候选 / 已休眠：复用 canSafelyDiscardTab 纯函数（与批量休眠同口径），
  //    绑定标签额外排除（休眠它们会让固定空间条目显示「未打开」造成误判）。
  let discardableCount = 0;
  let discardedCount = 0;
  for (const tab of tabs) {
    if (tab.discarded) {
      discardedCount += 1;
    } else if (canSafelyDiscardTab(tab) && !boundTabIds.has(tab.id)) {
      discardableCount += 1;
    }
  }

  // 3) 滞留预警：未激活超过 7 天的未固定标签（固定是用户主动长期保留，
  //    不属于「忘记关」；已休眠的已经不占内存，无需催促）。
  const staleTabs: StaleTab[] = [];
  for (const tab of tabs) {
    if (tab.active || tab.pinned || tab.discarded) continue;
    if (typeof tab.lastAccessed !== 'number' || !Number.isFinite(tab.lastAccessed)) continue;
    const idleMs = now - tab.lastAccessed;
    if (idleMs < STALE_TAB_MS) continue;
    staleTabs.push({
      id: tab.id,
      label: tab.title || tab.url || '',
      days: Math.floor(idleMs / (24 * 3600 * 1000))
    });
  }
  staleTabs.sort((a, b) => b.days - a.days || a.id - b.id);

  return {
    duplicateHotspots,
    discardableCount,
    staleTabs: staleTabs.slice(0, INSIGHT_TOP_N),
    discardedCount
  };
}
