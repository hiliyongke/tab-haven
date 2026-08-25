// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { syncMirror } from '@/platform/storage/SyncMirror';
import { DEFAULT_SETTINGS } from '@/core/schema/models';

const payload = (marker: string) => ({
  folders: [{ id: marker, name: marker, collapsed: false, createdAt: 1, items: [] }],
  pins: [],
  settings: DEFAULT_SETTINGS
});

/**
 * 镜像去抖行为规格：500ms 窗口内多次 schedule，最终落盘的必须是**最新** payload
 * （旧实现只写第一个 payload，密集操作后镜像陈旧，新设备拉取会丢数据）。
 */
describe('SyncMirror', () => {
  beforeEach(() => {
    // 仅替换定时器：Date.now 保持真实（pull 有 TTL 校验）。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    fakeBrowser.reset();
  });

  it('去抖窗口内多次 schedule 只落盘最新 payload', async () => {
    syncMirror.schedule(payload('first'));
    syncMirror.schedule(payload('second'));
    syncMirror.schedule(payload('third'));
    await vi.advanceTimersByTimeAsync(600);
    const mirror = await syncMirror.pull();
    expect(mirror?.folders[0]).toMatchObject({ id: 'third' });
  });

  it('窗口过后再次 schedule 正常写新一轮', async () => {
    syncMirror.schedule(payload('first'));
    await vi.advanceTimersByTimeAsync(600);
    syncMirror.schedule(payload('second'));
    await vi.advanceTimersByTimeAsync(600);
    const mirror = await syncMirror.pull();
    expect(mirror?.folders[0]).toMatchObject({ id: 'second' });
  });
});
