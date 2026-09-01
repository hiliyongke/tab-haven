import { describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';

describe('probe8', () => {
  it('tabGroups query', async () => {
    const r = await browser.tabGroups.query({ windowId: 0 }).then((v) => 'OK' + JSON.stringify(v)).catch((e) => 'ERR:' + String(e).slice(0, 120));
    console.log('tabGroups', r);
    const t = await browser.tabs.query({ windowId: 0 }).then((v) => 'OK' + v.length).catch((e) => 'ERR:' + String(e).slice(0, 120));
    console.log('tabs', t);
    expect(true).toBe(true);
  });
});
