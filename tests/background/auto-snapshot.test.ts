import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Snapshot } from '@/core/schema/models';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { runAutoSnapshot, syncAutoSnapshotAlarm } from '@/entrypoints/background/autoSnapshot';

/**
 * 定时自动快照（PRD FR-D5.2 触发①）：
 *  - 开关关闭时不产生任何快照（PRD 验收：未开启则关窗/定时均不产生快照）；
 *  - 现场无变化时不重复写入（否则定时快照会快速耗尽保留数并填满存储）；
 *  - 闹钟周期 = 用户设置值（不能小于 1 分钟，也不应被浏览器静默抬升为每分钟唤醒）。
 *
 * 环境说明：fake-browser 的 tabGroups.query 未实现，采集端已带 catch 兜底（视为无分组）；
 * windows.getAll 可用但不会自带标签，需手动 create 到目标窗口。
 */

function makeSnapshot(partial: Partial<Snapshot>): Snapshot {
  return {
    id: 's1',
    name: '自动快照',
    origin: 'auto',
    createdAt: Date.now(),
    tabCount: 1,
    tabs: [{ url: 'https://a.com/', title: 'A', pinned: false, muted: false }],
    ...partial
  };
}

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('定时自动快照', () => {
  it('开关关闭时完全不写入（默认关闭语义）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: false });
    await fakeBrowser.tabs.create({ url: 'https://a.com/' });
    const writeSpy = vi.spyOn(snapshotsRepository, 'write');

    await runAutoSnapshot();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(await snapshotsRepository.read()).toHaveLength(0);
  });

  it('开启后为有标签的窗口写入一份 auto 快照', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    await fakeBrowser.tabs.create({ url: 'https://a.com/' });

    await runAutoSnapshot();

    const all = await snapshotsRepository.read();
    expect(all).toHaveLength(1);
    expect(all[0]!.origin).toBe('auto');
    expect(all[0]!.tabs[0]!.url).toBe('https://a.com/');
  });

  it('内容与最新自动快照相同则不重复写入（去重防噪音）', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    await fakeBrowser.tabs.create({ url: 'https://a.com/' });
    // 预置一份与当前现场完全相同的自动快照
    await snapshotsRepository.write([makeSnapshot({ id: 'existing' })]);
    const writeSpy = vi.spyOn(snapshotsRepository, 'write');

    await runAutoSnapshot();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(await snapshotsRepository.read()).toHaveLength(1);
  });

  it('闹钟周期等于设置值，关闭开关时清除闹钟', async () => {
    await syncAutoSnapshotAlarm({
      ...DEFAULT_SETTINGS,
      autoSaveSnapshots: true,
      autoSnapshotIntervalMin: 30
    });
    const created = await fakeBrowser.alarms.get('tabs-auto-snapshot');
    expect(created?.periodInMinutes).toBe(30);

    await syncAutoSnapshotAlarm({ ...DEFAULT_SETTINGS, autoSaveSnapshots: false });
    expect(await fakeBrowser.alarms.get('tabs-auto-snapshot')).toBeUndefined();
  });
});
