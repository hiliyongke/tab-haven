import type { TabRecord } from '@/core/tab-types';
import { canSafelyDiscardTab } from '@/core/tab-types';
import { normalizeHostname } from '@/core/url/hostname';
import { DAY_MS } from '@/core/util/time';

/**
 * 标签习惯洞察：从当前窗口快照纯本地推导三类建议（重复重灾区 / 休眠候选 / 滞留预警），
 * 随事件刷新、不落盘。
 */

/** 重复重灾区阈值：同页面份数 ≥ 2 记为重复（与 DuplicateIndex 口径一致）。 */
const DUPLICATE_THRESHOLD = 2;

/** 滞留预警阈值：7 天未激活（ms）。 */
const STALE_TAB_DAYS = 7;
export const STALE_TAB_MS = STALE_TAB_DAYS * DAY_MS;

/** 每类洞察的 Top N 上限（防面板溢出，计算保持 O(n log n)）。 */
export const INSIGHT_TOP_N = 5;

/** 重复重灾区条目。 */
interface DuplicateHotspot {
  /** 站点域名（归一化：小写、去 www、去尾点）。 */
  host: string;
  /** 冗余标签数（该页面的全部份数）。 */
  count: number;
}

/** 滞留标签条目。 */
interface StaleTab {
  id: number;
  /** 标题（空则回退 URL）。 */
  label: string;
  /** 滞留整天数（向下取整）。 */
  days: number;
}

/** 窗口洞察汇总。 */
interface InsightsResult {
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
 * 洞察版页面身份键（www 归一化，比 webComparisonKey 宽松一档，服务于站点聚合展示）。
 * 端口必须参与身份，否则 localhost:3000 与 localhost:8080 会被判成同一页面，与严格口径结论矛盾。
 * pendingUrl 优先，与复用引擎同序。
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
      // parsed.port 在端口等于协议默认端口时为空串（WHATWG 口径），故无需另判默认值。
      const authority = parsed.port === '' ? host : `${host}:${parsed.port}`;
      return { key: `${authority}${parsed.pathname}${parsed.search}${parsed.hash}`, host };
    } catch {
      // 不可解析（内部页 / 空串）：尝试下一候选
    }
  }
  return null;
}

/** @param now 滞留判定时间基准，测试可注入固定值。 */
export function computeInsights(
  tabs: readonly TabRecord[],
  boundTabIds: ReadonlySet<number>,
  now: number = Date.now()
): InsightsResult {
  // 重复重灾区：≥2 份成组，按站点聚合冗余数。
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

  // 休眠候选：绑定标签排除（休眠它们会让固定空间条目显示「未打开」）。
  let discardableCount = 0;
  let discardedCount = 0;
  for (const tab of tabs) {
    if (tab.discarded) {
      discardedCount += 1;
    } else if (canSafelyDiscardTab(tab) && !boundTabIds.has(tab.id)) {
      discardableCount += 1;
    }
  }

  // 滞留预警：7 天未激活的未固定标签（绑定/pinned 是用户主动长期保留，已休眠不占内存）。
  const staleTabs: StaleTab[] = [];
  for (const tab of tabs) {
    if (tab.active || tab.pinned || tab.discarded || boundTabIds.has(tab.id)) continue;
    // 用实时 lastActivatedAt 而非面板侧被冻结的 lastAccessed，否则刚切过的标签会被误判为长期滞留。
    const activatedAt = tab.lastActivatedAt ?? tab.lastAccessed;
    if (typeof activatedAt !== 'number' || !Number.isFinite(activatedAt)) continue;
    const idleMs = now - activatedAt;
    if (idleMs < STALE_TAB_MS) continue;
    staleTabs.push({
      id: tab.id,
      label: tab.title || tab.url || '',
      days: Math.floor(idleMs / DAY_MS)
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
