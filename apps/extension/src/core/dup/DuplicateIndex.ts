import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { rankForKeep } from './DedupeByUrl';

/** 重复组：共享同一 URL 比较键的标签。 */
export interface DuplicateGroup {
  key: string;
  tabs: TabRecord[];
}

/**
 * 重复标签索引：按网页比较键把同网址标签归组，供清理重复与角标计数。
 * 只索引可判定的 web 页；构建后是不可变快照，标签变化需重建。
 */
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

  /** 全部重复组（同键 ≥ 2）；tabs 返回副本，防消费方原地 sort/push 改动索引。 */
  duplicates(): DuplicateGroup[] {
    return [...this.groupsByKey.entries()]
      .filter(([, tabs]) => tabs.length >= 2)
      .map(([key, tabs]) => ({ key, tabs: [...tabs] }));
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
 * 保留策略：keeper 口径委托 rankForKeep（最近激活 > 激活 > 固定 > 位置靠前 > id 大），
 * 与「同网址唯一化」共用单一事实来源，避免两处对同一组标签给出不同保留项。
 */
export class KeeperPolicy {
  /** 固定标签豁免清理（与复用引擎同口径）。 */
  readonly pinnedExempt: boolean;

  constructor(options: { pinnedExempt?: boolean } = {}) {
    this.pinnedExempt = options.pinnedExempt ?? true;
  }

  static readonly default = new KeeperPolicy();

  /** 选出保留者与可清理者；keeper 可空——空组没有标签可留，返回空结果而非假 keeper。 */
  select(group: DuplicateGroup): { keeper: TabRecord | undefined; removable: TabRecord[] } {
    const keeper = rankForKeep(group.tabs) ?? group.tabs[0];
    if (!keeper) return { keeper: undefined, removable: [] };

    const removable = group.tabs.filter(
      (tab) => tab !== keeper && !(this.pinnedExempt && tab.pinned)
    );
    return { keeper, removable };
  }
}
