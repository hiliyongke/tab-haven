import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { settingsRepository, snapshotsRepository } from '@/platform/storage/repositories';
import { runAutoSnapshot } from '@/entrypoints/background/autoSnapshot';

describe('probe6', () => {
  it('debug', async () => {
    await settingsRepository.write({ ...DEFAULT_SETTINGS, autoSaveSnapshots: true });
    console.log('read settings', JSON.stringify((await settingsRepository.read()).autoSaveSnapshots));
    await fakeBrowser.tabs.create({ url: 'https://a.com/' });
    const wins = await fakeBrowser.windows.getAll({ populate: false }).catch((e) => 'ERR' + e);
    console.log('wins', JSON.stringify(wins));
    const spy = vi.spyOn(snapshotsRepository, 'write');
    const spyRead = vi.spyOn(snapshotsRepository, 'read');
    await runAutoSnapshot();
    console.log('write calls', spy.mock.calls.length, 'read calls', spyRead.mock.calls.length);
    console.log('stored', JSON.stringify(await fakeBrowser.storage.local.get('tabhaven.snapshots.v1')));
    expect(true).toBe(true);
  });
});
