import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { openSidePanel, setActionClickBehavior } from '@/platform/sidePanel';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';

/**
 * 侧边栏平台适配的行为规格：打开（`openSidePanel`）与工具栏点击行为对齐
 * （`setActionClickBehavior`）。两者同属 `platform/sidePanel`，此前被拆成两个
 * 测试文件（side-panel / sidePanel），命名与风格都不统一，现合并到一处。
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

/**
 * 「点击图标是打开面板还是后台整理」由设置决定，而 `setPanelBehavior` 不跨浏览器
 * 会话持久 —— SW 每次唤醒都要对齐一次。这条链上没有返回值可断言，能钉死的是
 * **传参**与**降级**：能力缺失 / 调用失败都不能把设置层的意图变成异常抛给调用方。
 */
describe('setActionClickBehavior', () => {
  // 整体替换 `fakeBrowser.sidePanel`，而不是往既有对象上挂属性：上面那个
  // describe 的 afterEach 会把它置为 undefined，`fakeBrowser.reset()` 不会重建，
  // 逐个属性赋值会踩到「Cannot set properties of undefined」。
  const stubBehavior = (setPanelBehavior: unknown) => {
    (fakeBrowser as unknown as { sidePanel?: unknown }).sidePanel = { setPanelBehavior };
  };

  it('Given 开启「点击图标打开面板」When 对齐 Then 把开关原样传给浏览器', async () => {
    const spy = vi.fn(async () => undefined);
    stubBehavior(spy);

    await setActionClickBehavior(true);

    expect(spy).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('Given 关闭该行为 When 对齐 Then 传 false（点击走 SW 后台整理）', async () => {
    const spy = vi.fn(async () => undefined);
    stubBehavior(spy);

    await setActionClickBehavior(false);

    expect(spy).toHaveBeenCalledWith({ openPanelOnActionClick: false });
  });

  it('Given 浏览器不支持 setPanelBehavior When 对齐 Then 静默跳过而不抛异常', async () => {
    (fakeBrowser as unknown as { sidePanel?: unknown }).sidePanel = {};

    await expect(setActionClickBehavior(true)).resolves.toBeUndefined();
  });

  it('Given 浏览器调用失败 When 对齐 Then 吞掉异常（对齐失败不应打断 SW 启动）', async () => {
    stubBehavior(
      vi.fn(async () => {
        throw new Error('behavior rejected');
      })
    );

    await expect(setActionClickBehavior(true)).resolves.toBeUndefined();
  });
});
