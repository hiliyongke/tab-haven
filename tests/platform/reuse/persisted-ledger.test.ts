// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createPersistedAllowanceLedger } from '@/platform/reuse/persistedLedger';

/**
 * 持久化豁免账本（R-A 修复）：storage.session 镜像 + SW 重启恢复。
 * 场景：撤销恢复/快照恢复发放豁免后 SW 被回收，重新拉起时令牌不丢。
 */

const STORAGE_KEY = 'tabhaven.allowance.v1';

afterEach(() => {
  fakeBrowser.reset();
});

describe('createPersistedAllowanceLedger', () => {
  it('发放即落盘：镜像中可见令牌', async () => {
    const { ledger, ready } = createPersistedAllowanceLedger();
    await ready;
    ledger.grant(1, 'https://a.com/');

    const stored = await fakeBrowser.storage.session.get(STORAGE_KEY);
    expect(stored[STORAGE_KEY]).toEqual({ '1:https://a.com/': { tokens: 1, expiresAt: expect.any(Number) } });
  });

  it('SW 回收重启恢复：新账本从镜像继承未过期令牌', async () => {
    const first = createPersistedAllowanceLedger();
    await first.ready;
    first.ledger.grant(2, 'https://b.com/');

    // 模拟 SW 回收后重新拉起：全新账本实例
    const second = createPersistedAllowanceLedger();
    await second.ready;
    expect(second.ledger.consume(2, 'https://b.com/')).toBe(true);
    expect(second.ledger.consume(2, 'https://b.com/')).toBe(false);
  });

  it('消费后镜像同步移除（令牌一次性，重启后不复活）', async () => {
    const first = createPersistedAllowanceLedger();
    await first.ready;
    first.ledger.grant(3, 'https://c.com/');
    first.ledger.consume(3, 'https://c.com/');

    const second = createPersistedAllowanceLedger();
    await second.ready;
    expect(second.ledger.consume(3, 'https://c.com/')).toBe(false);
  });

  it('恢复完成前的发放不丢失：暂存快照在恢复后统一落盘', async () => {
    // 预置镜像（模拟上一生命周期写入）
    await fakeBrowser.storage.session.set({
      [STORAGE_KEY]: { '4:https://d.com/': { tokens: 1, expiresAt: Date.now() + 60_000 } }
    });

    const { ledger, ready } = createPersistedAllowanceLedger();
    // 不 await ready：恢复进行中就发生发放（竞态窗口）
    ledger.grant(5, 'https://e.com/');
    await ready;

    const second = createPersistedAllowanceLedger();
    await second.ready;
    expect(second.ledger.consume(4, 'https://d.com/')).toBe(true); // 镜像令牌恢复
    expect(second.ledger.consume(5, 'https://e.com/')).toBe(true); // 竞态期发放保留
  });
});
