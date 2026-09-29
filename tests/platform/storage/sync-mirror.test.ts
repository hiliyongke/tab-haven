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

  it('CJK 大数据按 UTF-8 字节分块：单块不超 8KB 配额且可完整回读', async () => {
    // 中文每字符 3 字节：4000 个汉字 ≈ 36KB，旧实现按字符切会产出 ~18KB 单块（必超配额）。
    const big = '汉'.repeat(4000);
    syncMirror.schedule({
      folders: [{ id: 'cjk', name: big, collapsed: false, createdAt: 1, items: [] }],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    await vi.advanceTimersByTimeAsync(600);

    const all = await fakeBrowser.storage.sync.get(null);
    const encoder = new TextEncoder();
    for (const [key, value] of Object.entries(all)) {
      expect(encoder.encode(String(value)).length, key).toBeLessThanOrEqual(8192);
    }
    const mirror = await syncMirror.pull();
    expect((mirror?.folders[0] as { name?: string })?.name).toBe(big);
  });

  it('新数据写成功后，旧 payload 的重试不得复活旧镜像', async () => {
    const sync = fakeBrowser.storage.sync;
    // 第一次落盘失败 → 排定 30s 重试（携带旧 payload）。
    const setSpy = vi.spyOn(sync, 'set').mockRejectedValueOnce(new Error('quota'));
    syncMirror.schedule(payload('old'));
    await vi.advanceTimersByTimeAsync(600);
    setSpy.mockRestore();

    // 窗口内新数据写成功：必须撤销旧重试。
    syncMirror.schedule(payload('new'));
    await vi.advanceTimersByTimeAsync(600);

    // 越过全部重试退避（30s+60s+…）后，镜像仍须是新数据。
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const mirror = await syncMirror.pull();
    expect(mirror?.folders[0]).toMatchObject({ id: 'new' });
  });

  it('clearAll 清除全部镜像块（关闭同步 / 清空数据后不得有残留）', async () => {
    syncMirror.schedule(payload('x'));
    await vi.advanceTimersByTimeAsync(600);

    await syncMirror.clearAll();

    const all = await fakeBrowser.storage.sync.get(null);
    expect(Object.keys(all).filter((key) => key.startsWith('tabs.sync.v1.'))).toHaveLength(0);
  });

  it('clearAll 排在在途写之后：在途写落盘不得让已清除的镜像复活', async () => {
    const sync = fakeBrowser.storage.sync;
    // 让在途写的 set 挂起：模拟去抖 flush 刚触发、用户立即关闭同步的竞态窗口。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setSpy = vi.spyOn(sync, 'set').mockImplementationOnce(() => gate);

    void syncMirror.write(payload('inflight'));
    const clearing = syncMirror.clearAll();

    // 放行在途写：其 set 先落盘，clearAll 的 remove 必须排在它之后执行。
    release();
    await clearing;
    setSpy.mockRestore();

    const all = await sync.get(null);
    expect(Object.keys(all).filter((key) => key.startsWith('tabs.sync.v1.'))).toHaveLength(0);
    expect(await syncMirror.pull()).toBeNull();
  });

  it('在途写失败排入的重试不得让 clearAll 之后的镜像复活', async () => {
    const sync = fakeBrowser.storage.sync;
    // 在途写失败：其 catch 会在 clearAll 的链头 cancelPending 之后才排入 30s 重试。
    const setSpy = vi.spyOn(sync, 'set').mockRejectedValueOnce(new Error('quota'));

    void syncMirror.write(payload('inflight-fails'));
    await syncMirror.clearAll();
    setSpy.mockRestore();

    // 越过全部重试退避：若 performClear 未在链内补撤，旧 payload 会被重试写回。
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const all = await sync.get(null);
    expect(Object.keys(all).filter((key) => key.startsWith('tabs.sync.v1.'))).toHaveLength(0);
    expect(await syncMirror.pull()).toBeNull();
  });
});
