import { pinIdentity } from '@/core/fixed/PinIdentity';
import type { TabRecord } from '@/core/tab-types';

/**
 * 常驻磁贴的运行时状态解析（纯函数，零 React / 浏览器依赖）。
 *
 * 从 `SortablePinnedTile.tsx` 迁出：① 组件文件按约定只放组件，否则 `PinnedStrip`
 * 为了拿索引要 import 一个组件模块（渲染无关耦合）；② 迁出后有独立可测单元。
 */

/** 固定标签磁贴的运行时状态（合并当前打开的标签：active / audible / discarded）。 */
interface PinRuntime {
  openTab?: TabRecord;
  isActive: boolean;
  isAudible: boolean;
  isDiscarded: boolean;
}

/** 无匹配标签时的运行时（模块级常量：避免每次渲染新建对象击穿下游 memo）。 */
export const CLOSED_PIN_RUNTIME: PinRuntime = Object.freeze({
  isActive: false,
  isAudible: false,
  isDiscarded: false
});

/**
 * 批量解析：一次遍历建「身份 → 运行时」索引。
 * 逐个解析是 O(磁贴数 × 标签数) 且重复计算 pinIdentity；建索引后 O(磁贴数 + 标签数)。
 * 顶部磁贴条每次标签快照都重算一遍，是这个量级下最该消除的浪费。
 */
export function buildPinRuntimeIndex(tabs: readonly TabRecord[]): Map<string, PinRuntime> {
  const byIdentity = new Map<string, PinRuntime>();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const identity = pinIdentity(tab.url);
    if (identity === null) continue;
    const existing = byIdentity.get(identity);
    // 激活标签优先（与 openPin 激活逻辑一致），否则保留首个。
    if (existing && (existing.isActive || !tab.active)) continue;
    byIdentity.set(identity, {
      openTab: tab,
      isActive: tab.active ?? false,
      isAudible: tab.audible ?? false,
      isDiscarded: tab.discarded ?? false
    });
  }
  return byIdentity;
}
