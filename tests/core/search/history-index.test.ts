import { describe, expect, it } from 'vitest';
import {
  buildHistoryTargets,
  decodeHistoryId,
  HISTORY_SNAPSHOT_LIMIT,
  HISTORY_TABS_PER_SNAPSHOT
} from '@/core/search/historyIndex';
import type { Snapshot, SnapshotTab } from '@/core/schema/models';

/**
 * 时间线搜索索引规格（P-01）：
 *  - 合成 id 与真实 tabId（非负）永不冲突；
 *  - 编码 → 解码往返无损（快照身份 + 条目身份）；
 *  - 只索引最近 N 份（性能护栏），乱序输入也按时间降序取。
 */

function snapTab(url: string, title = ''): SnapshotTab {
  return { url, title, pinned: false, muted: false };
}

function snapshotOf(id: string, createdAt: number, tabs: SnapshotTab[]): Snapshot {
  return { id, name: `快照 ${id}`, origin: 'manual', createdAt, tabCount: tabs.length, tabs };
}

describe('buildHistoryTargets', () => {
  it('Given 多份快照 When 构建目标 Then 全部条目进入索引且 id 为负数', () => {
    const snaps = [
      snapshotOf('a', 1_000, [snapTab('https://a.com/1', '标题一')]),
      snapshotOf('b', 2_000, [snapTab('https://b.com/1'), snapTab('https://b.com/2')])
    ];

    const targets = buildHistoryTargets(snaps);

    expect(targets).toHaveLength(3);
    for (const target of targets) {
      expect(target.id).toBeLessThan(0);
      expect(target.active).toBe(false);
    }
    // 时间降序：最新快照 b 的条目在前；标题为空时回退 URL（与引擎入参约定一致）
    expect(targets[0]!.title).toBe('https://b.com/1');
    expect(targets[2]!.title).toBe('标题一');
  });

  it('Given 超过上限份数 When 构建 Then 只索引最近 N 份', () => {
    // Given：LIMIT + 1 份快照，最早的一份应被淘汰
    const snaps = Array.from({ length: HISTORY_SNAPSHOT_LIMIT + 1 }, (_, i) =>
      snapshotOf(`snap-${i}`, i, [snapTab(`https://x.com/${i}`)])
    );

    const targets = buildHistoryTargets(snaps);

    // Then：恰好 N 条目标；最早的 snap-0 不在索引中
    expect(targets).toHaveLength(HISTORY_SNAPSHOT_LIMIT);
    const decodedOldest = decodeHistoryId(targets[0]!.id, snaps);
    expect(decodedOldest?.snapshotId).toBe(`snap-${HISTORY_SNAPSHOT_LIMIT}`);
  });

  it('Given 乱序输入 When 构建 Then 按创建时间降序编码（最新 = index 0）', () => {
    const snaps = [
      snapshotOf('old', 100, [snapTab('https://old.com')]),
      snapshotOf('new', 900, [snapTab('https://new.com')])
    ];

    const targets = buildHistoryTargets(snaps);

    // index 0 是最新的 new
    expect(decodeHistoryId(targets[0]!.id, snaps)?.snapshotId).toBe('new');
    expect(decodeHistoryId(targets[1]!.id, snaps)?.snapshotId).toBe('old');
  });
});

describe('decodeHistoryId', () => {
  it('Given 非负 id（真实 tabId）When 解码 Then 返回 null', () => {
    const snaps = [snapshotOf('a', 1, [snapTab('https://a.com')])];

    expect(decodeHistoryId(0, snaps)).toBeNull();
    expect(decodeHistoryId(42, snaps)).toBeNull();
  });

  it('Given 合法合成 id When 解码 Then 往返无损（快照与条目身份齐备）', () => {
    const snaps = [
      snapshotOf('a', 1_000, [snapTab('https://a.com/1', '第一条'), snapTab('https://a.com/2')])
    ];
    const targets = buildHistoryTargets(snaps);

    const hit = decodeHistoryId(targets[1]!.id, snaps);

    expect(hit).not.toBeNull();
    expect(hit!.snapshotId).toBe('a');
    expect(hit!.tabIndex).toBe(1);
    expect(hit!.tab.url).toBe('https://a.com/2');
    expect(hit!.snapshotName).toBe('快照 a');
    expect(hit!.snapshotTabCount).toBe(2);
  });

  it('Given 越界合成 id When 解码 Then 返回 null（不误读其它快照条目）', () => {
    const snaps = [snapshotOf('a', 1, [snapTab('https://a.com')])];

    // 快照序号越界
    expect(decodeHistoryId(-(1 * HISTORY_TABS_PER_SNAPSHOT + 1), snaps)).toBeNull();
    // 条目序号越界（快照只有 1 条）
    expect(decodeHistoryId(-2, snaps)).toBeNull();
  });
});
