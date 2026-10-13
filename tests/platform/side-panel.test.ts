// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setActionClickBehavior } from '@/platform/sidePanel';

/**
 * 行为规格：工具栏点击行为的对齐（`platform/sidePanel`）。
 *
 * 「点击图标是打开面板还是后台整理」由设置决定，而 `setPanelBehavior` 不跨浏览器
 * 会话持久 —— SW 每次唤醒都要对齐一次。这条链上没有返回值可断言，能钉死的是
 * **传参**与**降级**：能力缺失 / 调用失败都不能把设置层的意图变成异常抛给调用方。
 */

const sidePanel = () => fakeBrowser.sidePanel as unknown as { setPanelBehavior?: unknown };

afterEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('setActionClickBehavior', () => {
  it('Given 开启「点击图标打开面板」When 对齐 Then 把开关原样传给浏览器', async () => {
    const spy = vi.fn(async () => undefined);
    (sidePanel() as { setPanelBehavior: unknown }).setPanelBehavior = spy;

    await setActionClickBehavior(true);

    expect(spy).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('Given 关闭该行为 When 对齐 Then 传 false（点击走 SW 后台整理）', async () => {
    const spy = vi.fn(async () => undefined);
    (sidePanel() as { setPanelBehavior: unknown }).setPanelBehavior = spy;

    await setActionClickBehavior(false);

    expect(spy).toHaveBeenCalledWith({ openPanelOnActionClick: false });
  });

  it('Given 浏览器不支持 setPanelBehavior When 对齐 Then 静默跳过而不抛异常', async () => {
    const api = sidePanel() as { setPanelBehavior?: unknown };
    delete api.setPanelBehavior;

    await expect(setActionClickBehavior(true)).resolves.toBeUndefined();
  });

  it('Given 浏览器调用失败 When 对齐 Then 吞掉异常（对齐失败不应打断 SW 启动）', async () => {
    (sidePanel() as { setPanelBehavior: unknown }).setPanelBehavior = vi.fn(async () => {
      throw new Error('behavior rejected');
    });

    await expect(setActionClickBehavior(true)).resolves.toBeUndefined();
  });
});
