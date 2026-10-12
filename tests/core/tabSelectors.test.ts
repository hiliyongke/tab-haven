import { describe, expect, it } from 'vitest';
import { DuplicateIndex } from '@/core/dup/DuplicateIndex';
import {
  planDuplicateCleanup,
  selectArchivableTabs,
  selectSleepableTabs
} from '@/core/tabSelectors';
import type { TabRecord } from '@/core/tab-types';

/**
 * 行为规格：提示数量与实际执行必须同源（tabSelectors 是唯一口径）。
 *
 * 这三个选择器同时被「入口上显示的数量」与「按下后真实执行的目标」消费
 * （底栏「可休眠 N 个」/ 确认弹窗「将关闭 N 个」/ 清理按钮徽章）。两处口径一旦
 * 分叉，表现就是「提示 5 个、按下说没有」——直接失信于用户。
 */

function makeTab(partial: Partial<TabRecord>): TabRecord {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    // canSafelyDiscardTab 要求 lastAccessed 是有限数字（拿不到访问时间的标签
    // 不会被自动/手动休眠），默认值让「可休眠」类用例无需重复声明。
    lastAccessed: 0,
    ...partial
  };
}

const URL = 'https://a.com/';

describe('planDuplicateCleanup', () => {
  it('Given 一组重复标签 When 计算清理计划 Then 可清理项为除 keeper 外的全部副本', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 900 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 100 }),
      makeTab({ id: 3, index: 2, url: URL, lastAccessed: 500 })
    ];
    const index = DuplicateIndex.build(tabs);

    const plan = planDuplicateCleanup(index, []);

    expect(plan.removable.map((tab) => tab.id).sort()).toEqual([2, 3]);
    // keepIds 是「保留了谁」，供清理后的脉冲高亮使用。
    expect(plan.keepIds).toEqual([1]);
  });

  it('Given 副本被固定空间绑定 When 计算清理计划 Then 绑定项豁免（不进可清理）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 900 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 100 })
    ];
    const index = DuplicateIndex.build(tabs);

    const plan = planDuplicateCleanup(index, [2]);

    expect(plan.removable.map((tab) => tab.id)).toEqual([]);
  });

  it('Given 整组副本都被绑定 When 计算清理计划 Then 不记 keeper（本次没有任何清理可高亮）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: URL, lastAccessed: 900 }),
      makeTab({ id: 2, index: 1, url: URL, lastAccessed: 100 })
    ];
    const index = DuplicateIndex.build(tabs);

    const plan = planDuplicateCleanup(index, [2]);

    // 只留 keeper 一项时 groupRemovable 非空，但全部被绑定 → 实际一项也没关，
    // 高亮 keeper 会让用户以为刚发生过一次清理。
    expect(plan.keepIds).toEqual([]);
  });

  it('Given 无重复标签 When 计算清理计划 Then 结果为空（不产生 keeper）', () => {
    const tabs = [
      makeTab({ id: 1, index: 0, url: 'https://a.com/' }),
      makeTab({ id: 2, index: 1, url: 'https://b.com/' })
    ];
    const index = DuplicateIndex.build(tabs);

    const plan = planDuplicateCleanup(index, []);

    expect(plan.removable).toEqual([]);
    expect(plan.keepIds).toEqual([]);
  });
});

describe('selectSleepableTabs', () => {
  it('Given 混合状态的标签 When 选可休眠项 Then 排除激活 / 已休眠 / 绑定项', () => {
    const tabs = [
      makeTab({ id: 1, url: URL, active: true }),
      makeTab({ id: 2, url: URL, discarded: true }),
      makeTab({ id: 3, url: URL }),
      makeTab({ id: 4, url: URL })
    ];

    expect(selectSleepableTabs(tabs, [4]).map((tab) => tab.id)).toEqual([3]);
  });

  it('Given 播放音频的标签 When 选可休眠项 Then 排除（canSafelyDiscardTab 口径）', () => {
    const tabs = [makeTab({ id: 1, url: URL, audible: true })];

    expect(selectSleepableTabs(tabs, [])).toEqual([]);
  });

  it('Given 拿不到访问时间的标签 When 选可休眠项 Then 排除（休眠判定要求 lastAccessed 为有限数）', () => {
    const tabs = [makeTab({ id: 1, url: URL, lastAccessed: undefined })];

    expect(selectSleepableTabs(tabs, [])).toEqual([]);
  });
});

describe('selectArchivableTabs', () => {
  it('Given 含内部页的标签 When 选可归档项 Then 只保留 http(s) 页面', () => {
    const tabs = [
      makeTab({ id: 1, url: 'https://a.com/' }),
      makeTab({ id: 2, url: 'chrome://settings' }),
      makeTab({ id: 3, url: 'about:blank' })
    ];

    expect(selectArchivableTabs(tabs).map((tab) => tab.id)).toEqual([1]);
  });

  it('Given 无 url 的标签 When 选可归档项 Then 排除（无法以 URL 重新创建）', () => {
    const tabs = [makeTab({ id: 1, url: '' })];

    expect(selectArchivableTabs(tabs)).toEqual([]);
  });
});
