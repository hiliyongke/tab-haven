import type { TabRecord } from '@/core/tab-types';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { rankForKeep } from './DedupeByUrl';

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

/**
 * 重复标签索引：按「网页比较键」把同一网址的多个标签归组，供清理重复与角标计数使用。
 *
 * 只索引可判定的 web 页（内部页 / 无法取键的条目不入组）。
 * 索引是不可变快照：构建后不随标签变化，调用方需重建。
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

  /**
   * 全部重复组（同键 ≥ 2），按键首次出现顺序排列。
   *
   * 组的 `tabs` 返回**副本**：外泄内部数组引用时，任何消费方（如按保留策略
   * 排序的调用链）原地 `sort` / `push` 都会改动索引本身，而索引在渲染期被
   * 反复复用 —— 表现为清理目标随渲染次数漂移。
   */
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
 * 保留策略：从重复组中选出保留者（keeper）与可清理者。
 *
 * keeper 口径与「同网址唯一化」（settings.uniqueUrlTabs / 复用引擎）**完全一致**，
 * 均委托 dup/DedupeByUrl.ts 的 rankForKeep：最近访问 > 激活 > 固定 > 位置靠前 > id 大。
 * 统一理由（缺陷 IA-3）：两者都是「同一网址留一个」，用户预期是「留最近用过的
 * 那个」；两套口径会对同一组标签给出不同的保留项，且清理弹窗只能描述其中一种，
 * 必然有一处文案说谎。故收敛为单一事实来源，UI 文案按其口径描述。
 *
 * 本类只在此之上叠加「固定豁免」——复用引擎（ReuseCoordinator）在关闭前也会
 * 跳过 pinned 副本，二者同口径。
 */
export class KeeperPolicy {
  /** 固定标签豁免清理。 */
  readonly pinnedExempt: boolean;

  constructor(options: { pinnedExempt?: boolean } = {}) {
    this.pinnedExempt = options.pinnedExempt ?? true;
  }

  static readonly default = new KeeperPolicy();

  /**
   * 选出保留者与可清理者。
   *
   * `keeper` 刻意声明为可空：重复组长度为 0 时（上游 `duplicates()` 的
   * `length >= 2` 约束一旦放宽即可能出现）没有任何标签可留。此前用
   * `?? group.tabs[0]!` 兜底，等于用断言把「永不发生」的假设压进类型 ——
   * 返回类型宣称 `TabRecord` 而运行时是 `undefined`，下游 `keeper.id` 当场崩。
   * 可空类型逼调用方显式处理，空组返回空结果而非假 keeper。
   */
  select(group: DuplicateGroup): { keeper: TabRecord | undefined; removable: TabRecord[] } {
    // 口径直接委托单一事实来源：最近访问 > 激活 > 固定 > 位置靠前 > id 大，
    // 与复用引擎的「同网址唯一化」逐位一致（缺陷 IA-3：曾各自实现一套排序）。
    // 「位置靠前 / id 大」兜底按字段判定，不依赖传入顺序。
    const keeper = rankForKeep(group.tabs) ?? group.tabs[0];
    if (!keeper) return { keeper: undefined, removable: [] };

    const removable = group.tabs.filter(
      (tab) => tab !== keeper && !(this.pinnedExempt && tab.pinned)
    );
    return { keeper, removable };
  }
}
