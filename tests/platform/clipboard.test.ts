// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from '@/platform/clipboard';

/**
 * 行为规格：剪贴板写入（`src/platform/clipboard.ts`）。
 *
 * 这个出口存在的理由就是「失败必须可判定」：剪贴板在非安全上下文、缺少用户
 * 手势、权限被拒、文档未聚焦时都会抛错，且各浏览器抛的时机不一致。调用方
 * （标签行「复制网址」）据此二选一地提示成功或失败 —— 一旦这里吞掉异常或
 * 反过来抛出，用户就会遇到「点了复制，什么也没发生」。
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
