import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { openSidePanel } from '@/platform/sidePanel';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';

/**
 * 打开侧边栏的能力探测与降级。
 *
 * 断言重点是**失败路径留痕**：静默吞错会表现为「点『打开面板』没反应」，
 * 且用户无法区分「浏览器不支持」与「打开被拒绝」。
 */

function lastDiagnostic(): string | undefined {
  return readDiagnostics().at(-1)?.message;
}

function stubPanel(open: (opts: { windowId: number }) => Promise<void>) {
  (fakeBrowser as unknown as { sidePanel?: unknown }).sidePanel = { open };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  fakeBrowser.reset();
  clearDiagnostics();
  vi.restoreAllMocks();
});

describe('openSidePanel', () => {
  afterEach(() => {
    (fakeBrowser as unknown as { sidePanel?: unknown }).sidePanel = undefined;
  });

  it('浏览器不支持 sidePanel.open 时留痕并返回（Chrome < 116）', async () => {
    (fakeBrowser as unknown as { sidePanel?: unknown }).sidePanel = {};

    await openSidePanel();

    expect(lastDiagnostic()).toContain('不支持 sidePanel.open');
  });

  it('首选路径成功：不再走降级', async () => {
    const open = vi.fn(async () => undefined);
    stubPanel(open);
    const getCurrent = vi.spyOn(fakeBrowser.windows, 'getCurrent');

    await openSidePanel();

    expect(open).toHaveBeenCalledTimes(1);
    expect(getCurrent).not.toHaveBeenCalled();
  });

  it('显式 windowId 时按该窗口打开', async () => {
    const open = vi.fn(async () => undefined);
    stubPanel(open);

    await openSidePanel(42);

    expect(open).toHaveBeenCalledWith({ windowId: 42 });
  });

  it('首选失败时按当前窗口 id 二次尝试', async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('user gesture is required'))
      .mockResolvedValueOnce(undefined);
    stubPanel(open);
    vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: 55 } as never);

    await openSidePanel();

    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]![0]).toEqual({ windowId: 55 });
  });

  it('当前窗口拿不到时退到最近聚焦窗口', async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('user gesture is required'))
      .mockResolvedValueOnce(undefined);
    stubPanel(open);
    vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue(undefined as never);
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 77 } as never);

    await openSidePanel();

    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]![0]).toEqual({ windowId: 77 });
  });

  it('二次尝试也失败时留痕（不再静默吞掉「打开面板没反应」）', async () => {
    stubPanel(vi.fn(async () => Promise.reject(new Error('denied'))));
    vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: 55 } as never);

    await openSidePanel();

    expect(lastDiagnostic()).toContain('打开侧边栏失败');
  });

  it('拿不到任何窗口 id 时留痕并返回', async () => {
    stubPanel(vi.fn(async () => Promise.reject(new Error('denied'))));
    vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue(undefined as never);
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue(undefined as never);

    await openSidePanel();

    expect(lastDiagnostic()).toContain('无法确定目标窗口');
  });
});
