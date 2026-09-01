import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { buildSnapshot, persistSnapshot } from '@/platform/snapshot/snapshots';
import { mapTab } from '@/platform/tabs';

describe('probe7', () => {
  it('debug collect', async () => {
    await fakeBrowser.tabs.create({ url: 'https://a.com/' });
    const rawTabs = await fakeBrowser.tabs.query({ windowId: 0 });
    console.log('raw', JSON.stringify(rawTabs));
    const mapped = rawTabs.map(mapTab);
    console.log('mapped urls', JSON.stringify(mapped.map((t) => t.url)));
    const snap = buildSnapshot({ name: '', fallbackName: 'auto', origin: 'auto', windowId: 0, tabs: [{ url: 'https://a.com/', title: 'A', pinned: false, muted: false }] });
    console.log('snap', JSON.stringify(snap));
    try {
      const next = await persistSnapshot(snap);
      console.log('persisted', JSON.stringify(next));
    } catch (e) {
      console.log('persist error', String(e));
    }
    expect(true).toBe(true);
  });
});
