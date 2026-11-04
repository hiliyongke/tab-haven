import type { TabGroupRecord, TabRecord } from '@/core/tab-types';
import type { GroupMode } from '@/core/schema/models';
import type { SiteKey } from '@/core/site/SiteKey';

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
      /**
       * 因同站点归并而吸收进本分区的原生组 id（见 collectSiteMergeCandidates）。
       * 自动分组据此把同站点未分组标签并入既有原生组，而不是另建重复域名组。
       */
      mergedGroupIds?: readonly number[];
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

export interface SectionDerivation {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  /** 从临时区排除的标签（固定空间挂起/绑定、手动移出等）。 */
  excludedTabIds?: ReadonlySet<number>;
  /** 排序方式：browser 原生顺序 / recency 最近访问优先。 */
  sortMode?: 'browser' | 'recency';
  /** 非固定标签聚合模式；取值口径见 schema 的 GROUP_MODES。 */
  groupMode?: GroupMode;
  /** 同桶标签达到该数量才成组（桶口径由聚合模式决定），默认 2。 */
  threshold?: number;
  /**
   * 是否把「域名命名的原生组」里域名不符的成员拆出、按自身域名渲染（默认 true，展示视图）。
   * background 的自动分组对账须传 false：它要看到真实组成员才能校正 Chrome 组继承造成的
   * 域名漂移（planAutoGroupDomainCorrections），拆分会让漂移成员从 native 分区消失。
   */
  splitDriftedNativeTabs?: boolean;
  /**
   * 文案翻译函数（可选）。core 不依赖 i18n，调用方（UI）注入 i18next 的 t。
   * 缺省回退为恒等函数，便于纯逻辑单测（标题退化为 i18n key，不影响分区结构）。
   */
  translate?: (key: string) => string;
}

/** 同站点归并候选：一个"本质上是站点组"的原生组及其成员的站点坐标。 */
export interface SiteMergeCandidate {
  groupId: number;
  /** 策略口径下的原始分桶键：与 site 分区的 bucketId 精确比较，不受展示键改写影响。 */
  bucketId: string;
  /** 组内首个可解析成员的站点键（新建分区时派生展示键用）。 */
  sourceKey: SiteKey;
  /** 组内成员（非固定、未被固定空间排除），deriveSections 的排序已应用。 */
  memberTabs: TabRecord[];
}

/** 原生组派生视图条目：组元信息 + 组内标签。 */
export interface NativeGroupEntry {
  group: TabGroupRecord;
  groupTabs: TabRecord[];
}

export interface NativeGroupDrift {
  /** 拆分后的原生组（供渲染与归并候选识别）。 */
  visibleNativeGroups: NativeGroupEntry[];
  /** 从原生组拆出、改按自身域名聚合的标签。 */
  detachedTabs: TabRecord[];
  /** 本轮发生过拆分的组：状态不稳定，不参与同站点归并。 */
  detachedGroupIds: Set<number>;
}

export interface SitePlan {
  /** 站点分区（顺序与 aggregateBySite 输出一致）。 */
  sections: Extract<TemporarySection, { kind: 'site' }>[];
  /** 未成组的独立标签。 */
  singles: TabRecord[];
  /** 已并入站点分区的原生组 id。 */
  absorbedGroupIds: Set<number>;
}
