// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { openOptionsPage, openUrlInTab } from '@/platform/navigation';
import { hasPermissions, requestPermissions } from '@/platform/permissions';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';

/**
 * navigation / permissions：两处「薄封装」，价值全在**失败必须可观测**上。
 *
 * 这两类能力此前散落在各入口，被拒/失败时用户得不到任何反馈（打开设置页没反应、
 * 开关点了没反应）。收敛到 platform 后统一进诊断管道，本文件锁住该语义。
 */

function lastDiagnosticMessage(): string | undefined {
  return readDiagnostics().at(-1)?.message;
}

/** 静音诊断输出：logDegraded 走 console.warn，是被测行为的预期副作用。 */
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('navigation', () => {
  afterEach(() => {
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('openOptionsPage 调用浏览器 API', () => {
    const spy = vi
      .spyOn(fakeBrowser.runtime, 'openOptionsPage')
      .mockImplementation((() => Promise.resolve()) as never);
    openOptionsPage();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('openOptionsPage 失败时不抛错且留痕（调用点在事件处理器内）', async () => {
    vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockImplementation((() =>
      Promise.reject(new Error('denied'))) as never);
    expect(() => openOptionsPage()).not.toThrow();
    await vi.waitFor(() => expect(lastDiagnosticMessage()).toContain('打开设置页失败'));
  });

  it('openUrlInTab 以给定 URL 新建标签', async () => {
    const create = vi
      .spyOn(fakeBrowser.tabs, 'create')
      .mockImplementation((() => Promise.resolve({ id: 1 })) as never);
    await openUrlInTab('chrome://extensions/shortcuts');
    expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
  });

  it('openUrlInTab 失败时留痕且不向 UI 层抛错', async () => {
    vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((() =>
      Promise.reject(new Error('bad url'))) as never);
    await expect(openUrlInTab('chrome://nope')).resolves.toBeUndefined();
    expect(lastDiagnosticMessage()).toContain('打开标签失败');
  });
});

describe('permissions', () => {
  afterEach(() => {
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('hasPermissions 透传 contains 的布尔结果', async () => {
    const contains = vi
      .spyOn(fakeBrowser.permissions, 'contains')
      .mockImplementation((() => Promise.resolve(true)) as never);
    await expect(hasPermissions({ origins: ['<all_urls>'] })).resolves.toBe(true);
    expect(contains).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
  });

  it('hasPermissions 查询异常时返回 false 并留痕', async () => {
    vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((() =>
      Promise.reject(new Error('boom'))) as never);
    await expect(hasPermissions({ permissions: ['tabs'] })).resolves.toBe(false);
    expect(lastDiagnosticMessage()).toContain('权限查询失败');
  });

  it('requestPermissions 返回用户是否授予', async () => {
    const request = vi
      .spyOn(fakeBrowser.permissions, 'request')
      .mockImplementation((() => Promise.resolve(true)) as never);
    await expect(requestPermissions({ origins: ['<all_urls>'] })).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('requestPermissions 被拒绝时返回 false 并留痕（用户拒绝与手势外调用同一路径）', async () => {
    vi.spyOn(fakeBrowser.permissions, 'request').mockImplementation((() =>
      Promise.reject(new Error('user gesture required'))) as never);
    await expect(requestPermissions({ origins: ['<all_urls>'] })).resolves.toBe(false);
    expect(lastDiagnosticMessage()).toContain('权限申请失败或被拒绝');
  });
});
