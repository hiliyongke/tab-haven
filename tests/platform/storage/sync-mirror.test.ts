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

  it('超出同步配额时跳过写入而不是set 抛错后重试（避免白耗分钟级写配额）', async () => {
    /**
     * 事故原型：写侧只按总字节放行、读侧按块数判定，两把尺子错位时
     * 102000 < total ≤ 102400 会切出 18 块（> MAX_CHUNKS 17）并写入成功，
     * 而 pull 判定「分块超限」返回 null —— 镜像写进去了却永远读不出来，
     * 换机时新设备拿到 null，还会把本地空态推上云覆盖掉这份镜像。
     */
    const oversized = 'x'.repeat(103_000);
    syncMirror.schedule({
      folders: [{ id: 'big', name: oversized, collapsed: false, createdAt: 1, items: [] }],
      pins: [],
      settings: DEFAULT_SETTINGS
    });
    await vi.advanceTimersByTimeAsync(600);

    // 一条块都没落盘：容量超限是确定性的，重试只会反复撞配额。
    const all = await fakeBrowser.storage.sync.get(null);
    expect(Object.keys(all).filter((key) => key.startsWith('tabs.sync.v1.'))).toEqual([]);
    // 必须留痕（设置页据此提示「同步未生效」），且不得污染拉取分类。
    expect(syncMirror.readLastPullIssue()).not.toBe('chunk-limit');
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

  it('镜像分块数超出同步配额：返回 null 但标记为 chunk-limit（而非「从未同步过」）', async () => {
    // Given meta 声明的分块数超过 MAX_CHUNKS（64）——镜像存在但拿不全
    await fakeBrowser.storage.sync.set({
      'tabs.sync.v1.meta': JSON.stringify({ count: 65 })
    });

    // When
    const mirror = await syncMirror.pull();

    // Then 数据拿不到，但成因必须留痕（否则设置页会把它当成「从未同步过」）
    expect(mirror).toBeNull();
    expect(syncMirror.readLastPullIssue()).toBe('chunk-limit');
  });

  it('sync 区为空：标记 none（正常的「从未同步过」，不是故障）', async () => {
    const mirror = await syncMirror.pull();
    expect(mirror).toBeNull();
    expect(syncMirror.readLastPullIssue()).toBe('none');
  });

  it('镜像缺块：标记 unreadable（本该有镜像却读不全）', async () => {
    // Given meta 声明 3 块，实际只有第 0 块
    await fakeBrowser.storage.sync.set({
      'tabs.sync.v1.meta': JSON.stringify({ count: 3 }),
      'tabs.sync.v1.0': JSON.stringify({
        at: Date.now(),
        folders: [],
        pins: [],
        settings: DEFAULT_SETTINGS
      })
    });

    const mirror = await syncMirror.pull();

    expect(mirror).toBeNull();
    expect(syncMirror.readLastPullIssue()).toBe('unreadable');
  });

  it('镜像载荷结构不符：标记 unreadable', async () => {
    await fakeBrowser.storage.sync.set({
      'tabs.sync.v1.meta': JSON.stringify({ count: 1 }),
      // 缺 folders / pins / settings —— 不是合法镜像
      'tabs.sync.v1.0': JSON.stringify({ at: Date.now() })
    });

    const mirror = await syncMirror.pull();

    expect(mirror).toBeNull();
    expect(syncMirror.readLastPullIssue()).toBe('unreadable');
  });

  it('meta 损坏（非 JSON / count 非数字）：标记 unreadable', async () => {
    await fakeBrowser.storage.sync.set({ 'tabs.sync.v1.meta': 'not-json' });
    expect(await syncMirror.pull()).toBeNull();
    expect(syncMirror.readLastPullIssue()).toBe('unreadable');

    await fakeBrowser.storage.sync.set({ 'tabs.sync.v1.meta': JSON.stringify({ count: 'x' }) });
    expect(await syncMirror.pull()).toBeNull();
    expect(syncMirror.readLastPullIssue()).toBe('unreadable');
  });

  it('镜像超过 30 天未更新：视为过期并标记 unreadable', async () => {
    await fakeBrowser.storage.sync.set({
      'tabs.sync.v1.meta': JSON.stringify({ count: 1 }),
      'tabs.sync.v1.0': JSON.stringify({
        at: Date.now() - 31 * 24 * 60 * 60 * 1000,
        folders: [],
        pins: [],
        settings: DEFAULT_SETTINGS
      })
    });

    const mirror = await syncMirror.pull();

    expect(mirror).toBeNull();
    expect(syncMirror.readLastPullIssue()).toBe('unreadable');
  });

  it('分类不粘住上一次结果：正常拉取后再次损坏必须回落为 unreadable', async () => {
    // Given 一次正常回读（ok）
    syncMirror.schedule(payload('fresh'));
    await vi.advanceTimersByTimeAsync(600);
    expect(await syncMirror.pull()).not.toBeNull();
    expect(syncMirror.readLastPullIssue()).toBe('ok');

    // When 镜像随后损坏
    await fakeBrowser.storage.sync.set({ 'tabs.sync.v1.meta': 'broken' });
    await syncMirror.pull();

    // Then 上一次的 ok 不得残留
    expect(syncMirror.readLastPullIssue()).toBe('unreadable');
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
