// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { PopupLoadErrorState, PopupLoadingSkeleton } from '@/entrypoints/popup/PopupListStates';

/**
 * 弹窗列表三态：加载骨架屏与加载失败态。
 *
 * 这两个组件此前 0% 覆盖，而它们是「数据尚未就绪 / 数据读不出来」时用户在弹窗里
 * 唯一能看到的东西。弹窗是 420px 宽的瞬时浮层，没有侧边栏那样的常驻上下文可供
 * 比对，状态缺失直接表现为「点了图标却不知道发生了什么」。这里锁住三件事：
 *   1. 骨架屏对视觉是占位（aria-hidden），但对读屏必须有可播报的「正在读取」——
 *      否则「加载中」在听觉上是一片空白；
 *   2. 失败态要给出原因 + 可点的重试出口（此前只写诊断日志，界面照常显示
 *      「输入以搜索」，用户无法区分「没匹配」与「数据根本没加载」）；
 *   3. 重试按钮真的回调（不是装饰性按钮）。
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('弹窗列表三态', () => {
  it('加载中：骨架条对读屏隐藏，但另有可播报的「正在读取」', () => {
    const { container } = render(<PopupLoadingSkeleton />);

    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('popup.loading'));
    // 骨架条是纯视觉占位：不进可访问性树，避免读屏念出一串无意义占位
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('加载失败：说明原因并给出重试出口，点击即回调', () => {
    const onRetry = vi.fn();
    render(<PopupLoadErrorState onRetry={onRetry} />);

    expect(screen.getByText(i18n.t('errors.loadFailedTitle'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('popup.loadFailedHint'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('errors.retry') }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
