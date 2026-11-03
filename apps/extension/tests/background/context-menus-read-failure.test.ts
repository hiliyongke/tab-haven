import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearDiagnostics } from '@/platform/diagnostics';
import { foldersRepository, pinsRepository } from '@/platform/storage/repositories';
import { addEntryToFolder, addPinFromTab } from '@/platform/background/contextMenus';

describe('右键菜单 readStrict 失败边界', () => {
  afterEach(() => {
    fakeBrowser.reset();
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('文件夹基线读取失败：返回 failed，不写盘', async () => {
    vi.spyOn(foldersRepository, 'readStrict').mockRejectedValue(new Error('read failed'));
    const write = vi.spyOn(foldersRepository, 'write');

    await expect(addEntryToFolder('folder', { url: 'https://a.com/', title: 'A' })).resolves.toBe(
      'failed'
    );

    expect(write).not.toHaveBeenCalled();
  });

  it('磁贴基线读取失败：返回 false，不写盘', async () => {
    vi.spyOn(pinsRepository, 'readStrict').mockRejectedValue(new Error('read failed'));
    const write = vi.spyOn(pinsRepository, 'write');

    await expect(addPinFromTab({ url: 'https://a.com/', title: 'A' })).resolves.toBe(false);

    expect(write).not.toHaveBeenCalled();
  });
});
