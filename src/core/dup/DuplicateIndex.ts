import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';

/**
 * 重复标签索引：以 URL 比较键为分组键的只读索引。
 *
 * 构建一次（O(n)），提供多次查询；与"保留谁"的策略（KeeperPolicy）解耦——
 * 索引只回答"哪些标签共享同一个网址"，策略回答"保留哪一个"。
 */

interface DuplicateGroup {
  /** 比较键（与检视结果的 comparisonKey 一致）。 */
  key: string;
  /** 共享该网址的全部标签（按传入顺序）。 */
  tabs: TabRecord[];
}

export class DuplicateIndex {
  private readonly groupsByKey: ReadonlyMap<string, TabRecord[]>;

  private constructor(groupsByKey: ReadonlyMap<string, TabRecord[]>) {
    this.groupsByKey = groupsByKey;
  }

  /** 构建索引：仅对可判定的 web 页建组。 */
  static build(tabs: readonly TabRecord[]): DuplicateIndex {
    const groupsByKey = new Map<string, TabRecord[]>();
    for (const tab of tabs) {
      const key = webComparisonKey(tab.url, tab.pendingUrl);
      if (!key) continue;
      const group = groupsByKey.get(key) || [];
      group.push(tab);
      groupsByKey.set(key, group);
    }
    return new DuplicateIndex(groupsByKey);
  }

  /** 全部重复组（同键 ≥ 2），按键首次出现顺序排列。 */
  duplicates(): DuplicateGroup[] {
    return [...this.groupsByKey.entries()]
      .filter(([, tabs]) => tabs.length >= 2)
      .map(([key, tabs]) => ({ key, tabs }));
  }

  /** 每键的份数（含 1）。 */
  counts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [key, tabs] of this.groupsByKey) {
      counts.set(key, tabs.length);
    }
    return counts;
  }

  /** 按策略给出可清理标签。 */
  removable(policy: KeeperPolicy): TabRecord[] {
    return this.duplicates().flatMap((group) => policy.select(group).removable);
  }
}

/**
 * 保留策略：从重复组中选出保留者（keeper）与可清理者。
 *
 * 行为规格（PRD 附录 C-8）：保留当前激活 > 已固定 > 位置靠前；
 * 固定标签一律豁免清理。
 *
 * 分工说明：本策略服务于「重复清理」面板（DuplicateIndex 消费方）；
 * 复用引擎的「保留最近访问者」策略见 dup/DedupeByUrl.ts 的 rankForKeep，勿混用。
 */
export class KeeperPolicy {
  /** 固定标签豁免清理。 */
  readonly pinnedExempt: boolean;

  constructor(options: { pinnedExempt?: boolean } = {}) {
    this.pinnedExempt = options.pinnedExempt ?? true;
  }

  static readonly default = new KeeperPolicy();

  select(group: DuplicateGroup): { keeper: TabRecord; removable: TabRecord[] } {
    // 重复组长度 ≥ 2，组内必有元素；「位置靠前」兜底按 index 取最小，
    // 不依赖传入顺序（调用方传入未排序数组时行为依然确定）。
    const keeper =
      group.tabs.find((tab) => tab.active) ??
      group.tabs.find((tab) => tab.pinned) ??
      group.tabs.reduce((front, tab) => (tab.index < front.index ? tab : front));

    const removable = group.tabs.filter((tab) => tab !== keeper && !(this.pinnedExempt && tab.pinned));
    return { keeper, removable };
  }
}
