import { describe, expect, it } from 'vitest';
import { NO_GROUP } from '@/core/tab-types';
import { mapTab, mapTabGroup } from '@/platform/tabAdapters';

/**
 * chrome.tabs.Tab / chrome.tabGroups.TabGroup 是浏览器生成类型，测试桩只需最小字段。
 * 对象字面量按 platform/tabs 既有测试的同一写法收窄为被测参数形状。
 */
function chromeTab(partial: Record<string, unknown>) {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    active: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    ...partial
  } as never;
}

function chromeGroup(partial: Record<string, unknown>) {
  return { id: 1, ...partial } as never;
}

describe('mapTab', () => {
  it('Given 原生标签含附加字段 When 映射 Then 拆出正整数 splitViewId 并保留 attention/language', () => {
    const mapped = mapTab(chromeTab({ id: 7, splitViewId: 3, attention: true, language: 'zh-CN' }));

    expect(mapped.id).toBe(7);
    expect(mapped.splitViewId).toBe(3);
    expect(mapped.attention).toBe(true);
    expect(mapped.language).toBe('zh-CN');
  });

  it('Given splitViewId 为 0 或非数 When 映射 Then 视为未分屏（undefined）', () => {
    expect(mapTab(chromeTab({ splitViewId: 0 })).splitViewId).toBeUndefined();
    expect(mapTab(chromeTab({ splitViewId: 'x' })).splitViewId).toBeUndefined();
  });

  it('Given 原生标签缺 id/windowId/groupId When 映射 Then id/windowId 兜底 -1 且 groupId 用 NO_GROUP', () => {
    const mapped = mapTab(chromeTab({ id: undefined, windowId: undefined, groupId: undefined }));

    expect(mapped.id).toBe(-1);
    expect(mapped.windowId).toBe(-1);
    expect(mapped.groupId).toBe(NO_GROUP);
  });
});

describe('mapTabGroup', () => {
  it('Given 原生标签组 When 映射 Then 保留 id/title/color/collapsed', () => {
    const mapped = mapTabGroup(
      chromeGroup({ id: 5, title: '工作', color: 'blue', collapsed: true })
    );

    expect(mapped).toEqual({ id: 5, title: '工作', color: 'blue', collapsed: true });
  });
});
