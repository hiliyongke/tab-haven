import { useEffect } from 'react';
import { planAutoGroups } from '@/core/group/AutoGrouping';
import { disbandAutoGroups, syncAutoGroups } from '@/platform/group/AutoGroupSync';

/**
 * 自动原生分组：把聚合结果落成浏览器 tabGroups，并在关闭开关时解散本功能创建的组。
 *
 * 从 `App.tsx` 抽出。两个 effect 都是「设置 → 浏览器原生组」的单向同步，
 * 与面板渲染无关，抽出的直接收益是让 `App.tsx` 只剩「派生 → 渲染」的职责。
 *
 * 幂等性依赖两处外部保证，改这里之前先确认它们仍成立：
 *  - `syncAutoGroups` 只为**尚无 groupId** 的标签建组，因此分区标题随语言变化而重算是安全的；
 *  - `disbandAutoGroups` 只解散记录在案、由本功能创建的组。
 */

export interface AutoGroupSyncOptions {
  /** 未过滤态的分区基线（由 deriveSections 得出）。 */
  sections: Parameters<typeof planAutoGroups>[0];
  autoGroupNative: boolean;
  /** 聚合模式：`opener`（来源树）下不做原生分组。 */
  groupMode: 'site' | 'opener' | 'language';
}

export function useAutoGroupSync(options: AutoGroupSyncOptions): void {
  const { sections, autoGroupNative, groupMode } = options;

  useEffect(() => {
    if (!autoGroupNative || groupMode === 'opener') return;
    const plans = planAutoGroups(sections);
    // syncAutoGroups 幂等（只为尚无 groupId 的标签建组），语言切换后分区标题
    // 随之重算是安全的，不会重复建组。
    if (plans.length > 0) void syncAutoGroups(plans);
  }, [sections, autoGroupNative, groupMode]);

  // 关闭自动分组时：解散本功能创建的组（标签回到未分组，记录清空）。
  useEffect(() => {
    if (autoGroupNative) return;
    void disbandAutoGroups();
  }, [autoGroupNative]);
}
