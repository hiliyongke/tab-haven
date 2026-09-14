import { describe, expect, it } from 'vitest';
import {
  buildPartialSnapshot,
  snapshotDiff,
  type SnapshotDiffResult
} from '@/core/snapshot/snapshotDiff';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';

/**
 * 快照恢复 diff 行为规格（P-02）。
 *
 * 口径契约：snapshotDiff 与 platform/snapshot/snapshots.ts 的私有
 * missingTabsOf 必须永远一致——预览说「将新建 N」，恢复就真的新建 N。
 * 本文件锁住这一契约：分类、去重、authority 归一化、部分快照约束。
 */

/** 构造快照条目（与 restore-snapshot.test.ts 的 snapTab 同风格）。 */
function snapTab(partial: Partial<SnapshotTab> & { url: string }): SnapshotTab {
  return { title: '', pinned: false, muted: false, ...partial };
}

/** 构造一份合法快照（tabCount 与 tabs.length 锁定一致）。 */
function snapshotOf(tabs: SnapshotTab[]): Snapshot {
  return {
    id: 'snap-test',
    name: 'test',
    origin: 'manual',
    createdAt: 1_700_000_000_000,
    tabCount: tabs.length,
    tabs
  };
}

describe('snapshotDiff：三分类', () => {
  it('Given 窗口已存在同键标签 When diff Then 计入 existing', () => {
    // Given：快照一条 https://example.com/a，窗口已开同 URL
    const tabs = [snapTab({ url: 'https://example.com/a', title: 'A' })];
    const existingKeys = new Set(['https://example.com/a']);

    // When
    const result = snapshotDiff(tabs, existingKeys);

    // Then：existing 1、create 0
    expect(result.counts).toEqual({ create: 0, existing: 1, skipped: 0 });
    expect(result.existing[0]!.tab.url).toBe('https://example.com/a');
  });

  it('Given 窗口缺失该 URL When diff Then 计入 willCreate', () => {
    const tabs = [snapTab({ url: 'https://example.com/new', title: 'New' })];

    const result = snapshotDiff(tabs, new Set());

    expect(result.counts).toEqual({ create: 1, existing: 0, skipped: 0 });
    expect(result.willCreate[0]!.tab.title).toBe('New');
  });

  it('Given 非 http(s) 条目 When diff Then 计入 skipped（内部页不可恢复）', () => {
    const tabs = [
      snapTab({ url: 'chrome://settings' }),
      snapTab({ url: 'about:blank' }),
      snapTab({ url: 'https://example.com/ok' })
    ];

    const result = snapshotDiff(tabs, new Set());

    expect(result.counts).toEqual({ create: 1, existing: 0, skipped: 2 });
    expect(result.skipped.map((entry) => entry.tab.url)).toEqual([
      'chrome://settings',
      'about:blank'
    ]);
  });

  it('Given 快照内同键重复条目 When diff Then 首条入分类、后续入 skipped', () => {
    // Given：两条完全同 URL（authority 归一化后同键）
    const tabs = [
      snapTab({ url: 'https://example.com/a', title: '第一份' }),
      snapTab({ url: 'https://EXAMPLE.com:443/a', title: '重复' })
    ];

    const result = snapshotDiff(tabs, new Set());

    // Then：首条 create、重复条 skipped（missingTabsOf 的 seen 双去重口径）
    expect(result.counts).toEqual({ create: 1, existing: 0, skipped: 1 });
    expect(result.willCreate[0]!.tab.title).toBe('第一份');
    expect(result.skipped[0]!.tab.title).toBe('重复');
  });

  it('Given 大小写与默认端口差异 When diff Then 归一化后判为同键 existing', () => {
    // Given：快照写 HTTPS://Example.com:443/x，窗口键集合为归一化后的同页键
    const tabs = [snapTab({ url: 'HTTPS://Example.com:443/x' })];
    const existingKeys = new Set(['https://example.com/x']);

    const result = snapshotDiff(tabs, existingKeys);

    expect(result.counts).toEqual({ create: 0, existing: 1, skipped: 0 });
  });

  it('Given 非默认端口 When diff Then 端口参与键，不与 443 混淆', () => {
    const tabs = [snapTab({ url: 'https://example.com:8443/x' })];
    const existingKeys = new Set(['https://example.com/x']);

    const result = snapshotDiff(tabs, existingKeys);

    // 端口不同 = 不同页面：create 而非 existing
    expect(result.counts).toEqual({ create: 1, existing: 0, skipped: 0 });
  });

  it('Given 空 tabs When diff Then 三计数全零', () => {
    const result = snapshotDiff([], new Set(['https://example.com/a']));

    expect(result.counts).toEqual({ create: 0, existing: 0, skipped: 0 });
  });
});

describe('snapshotDiff：与恢复口径的一致性（预览 = 实际）', () => {
  it('Given 混合条目集 When diff Then willCreate 恰为恢复端会新建的集合', () => {
    // Given：2 条新建 + 1 条已存在 + 1 条内部页 + 1 条快照内重复
    const tabs = [
      snapTab({ url: 'https://a.com/1' }),
      snapTab({ url: 'https://b.com/2' }),
      snapTab({ url: 'https://c.com/3' }),
      snapTab({ url: 'chrome://internal' }),
      snapTab({ url: 'https://a.com/1' })
    ];
    const existingKeys = new Set(['https://c.com/3']);

    const result: SnapshotDiffResult = snapshotDiff(tabs, existingKeys);

    // Then：恢复端 missingTabsOf 会且只会新建 a.com/1 与 b.com/2
    expect(result.willCreate.map((entry) => entry.tab.url)).toEqual([
      'https://a.com/1',
      'https://b.com/2'
    ]);
    expect(result.counts).toEqual({ create: 2, existing: 1, skipped: 2 });
  });
});

describe('buildPartialSnapshot：选择性恢复的部分快照', () => {
  it('Given 勾选子集 When 构造部分快照 Then tabCount 同步重算', () => {
    const full = snapshotOf([
      snapTab({ url: 'https://a.com/1' }),
      snapTab({ url: 'https://b.com/2' }),
      snapTab({ url: 'https://c.com/3' })
    ]);
    const selected = [full.tabs[0]!, full.tabs[2]!];

    const partial = buildPartialSnapshot(full, selected);

    // schema refine 约束：tabCount === tabs.length（否则恢复前校验即失败）
    expect(partial.tabCount).toBe(2);
    expect(partial.tabs).toHaveLength(2);
    expect(partial.tabs.map((tab) => tab.url)).toEqual(['https://a.com/1', 'https://c.com/3']);
    // 身份字段保留（恢复分组/来源徽标依赖）
    expect(partial.id).toBe(full.id);
    expect(partial.origin).toBe(full.origin);
  });

  it('Given 空勾选集 When 构造部分快照 Then 得到合法空快照（恢复端返回 0）', () => {
    const full = snapshotOf([snapTab({ url: 'https://a.com/1' })]);

    const partial = buildPartialSnapshot(full, []);

    expect(partial.tabCount).toBe(0);
    expect(partial.tabs).toEqual([]);
  });

  it('Given 部分快照 When zod 校验 Then 通过 SnapshotSchema refine', async () => {
    const { SnapshotSchema } = await import('@/core/schema/models');
    const full = snapshotOf([
      snapTab({ url: 'https://a.com/1' }),
      snapTab({ url: 'https://b.com/2' })
    ]);
    const partial = buildPartialSnapshot(full, [full.tabs[1]!]);

    expect(SnapshotSchema.safeParse(partial).success).toBe(true);
  });
});
