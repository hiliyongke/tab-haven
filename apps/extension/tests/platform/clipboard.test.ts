// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from '@/platform/clipboard';

/**
 * 剪贴板行为规格：写入成功时返回 true；剪贴板不可用或写入失败时返回 false。
 */

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function stubClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('writeClipboardText', () => {
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    vi.restoreAllMocks();
  });

  it('Given 剪贴板可用 When 写入 Then 返回 true 且文本原样落剪贴板', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard({ writeText });

    await expect(writeClipboardText('https://a.com/')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://a.com/');
  });

  it('Given 剪贴板抛错（权限被拒 / 非安全上下文）When 写入 Then 返回 false 而不是抛出', async () => {
    // 抛出会变成调用点的未处理 rejection，用户既看不到成功也看不到失败提示。
    stubClipboard({ writeText: () => Promise.reject(new Error('denied')) });

    await expect(writeClipboardText('https://a.com/')).resolves.toBe(false);
  });

  it('Given 环境根本没有 clipboard When 写入 Then 返回 false（不访问 undefined）', async () => {
    stubClipboard(undefined);

    await expect(writeClipboardText('https://a.com/')).resolves.toBe(false);
  });
});
