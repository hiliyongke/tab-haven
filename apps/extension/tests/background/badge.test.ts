import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { settingsRepository } from '@/platform/storage/repositories';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import { refreshBadge, refreshBadgeSoon, showBadgeOverride } from '@/platform/background/badge';
import { syncCachedSettings } from '@/platform/background/shared';

/**
 * 工具栏角标。
 *
 * 角标是「用户唯一能在不打开面板时看到的状态」（重复数 / 标签数 / 休眠数），
 * 因此既要断言各 badgeMode 的取值分支，也要锁住那条**性能约束**：
 * `off` 模式必须跳过全量 `tabs.query`（否则每个标签事件都白查一次全量）。
 */

interface FakeTab {
  url?: string;
  pendingUrl?: string;
  discarded?: boolean;
}

/** 安装 action API 与标签夹具，返回各 spy。 */
function installBadgeApi(tabs: FakeTab[] = []) {
  // 显式给出入参签名：裸 vi.fn(async () => …) 的 mock.calls 会被推断为 []，
  // 断言「调用序列」时取不到 args[0]（见 installMenusApi 的同款处理）。
  const setBadgeText = vi.fn<(args: { text: string }) => Promise<void>>(async () => undefined);
  const setBadgeBackgroundColor = vi.fn(async () => undefined);
  const setTitle = vi.fn(async () => undefined);
  (fakeBrowser as unknown as { action?: unknown }).action = {
    setBadgeText,
    setBadgeBackgroundColor,
    setTitle
  };
  const query = vi.fn(async () => tabs);
  (fakeBrowser.tabs as unknown as { query: unknown }).query = query;
  return { setBadgeText, setBadgeBackgroundColor, setTitle, query };
}

async function applyBadgeMode(badgeMode: 'auto' | 'count' | 'dups' | 'off'): Promise<void> {
  await settingsRepository.write({ ...DEFAULT_SETTINGS, badgeMode });
  await syncCachedSettings();
}

beforeEach(() => {
  // refreshBadgeSoon 是 500ms 防抖，必须用假定时器才能确定性地推进（微任务不受影响）
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  fakeBrowser.reset();
  (fakeBrowser as unknown as { action?: unknown }).action = undefined;
  clearDiagnostics();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('refreshBadge', () => {
  it('off 模式：清空角标且**跳过全量查询**（性能约束）', async () => {
    await applyBadgeMode('off');
    const { setBadgeText, query } = installBadgeApi([{ url: 'https://a.com/' }]);

    await refreshBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(query).not.toHaveBeenCalled();
  });

  it('auto + 有重复：显示重复组数并转红（警示优先于总数）', async () => {
    await applyBadgeMode('auto');
    const { setBadgeText, setBadgeBackgroundColor } = installBadgeApi([
      { url: 'https://dup.com/a' },
      { url: 'https://dup.com/a' },
      { url: 'https://other.com/' }
    ]);

    await refreshBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '1' });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#dc2626' });
  });

  it('auto + 无重复：显示标签总数', async () => {
    await applyBadgeMode('auto');
    const { setBadgeText, setBadgeBackgroundColor } = installBadgeApi([
      { url: 'https://a.com/' },
      { url: 'https://b.com/' }
    ]);

    await refreshBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '2' });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#6366f1' });
  });

  it('count 模式：恒显标签总数', async () => {
    await applyBadgeMode('count');
    const { setBadgeText } = installBadgeApi([
      { url: 'https://dup.com/' },
      { url: 'https://dup.com/' }
    ]);

    await refreshBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '2' });
  });

  it('dups 模式 + 无重复：角标为空（不显示 0 制造噪音）', async () => {
    await applyBadgeMode('dups');
    const { setBadgeText, setBadgeBackgroundColor } = installBadgeApi([{ url: 'https://a.com/' }]);

    await refreshBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#dc2626' });
  });

  it('非 web 页（chrome:// 等）不参与重复统计', async () => {
    await applyBadgeMode('dups');
    const { setBadgeText } = installBadgeApi([
      { url: 'chrome://settings' },
      { url: 'chrome://settings' }
    ]);

    await refreshBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  it('导航中标签用 pendingUrl 归一化（与面板统计口径一致）', async () => {
    await applyBadgeMode('dups');
    const { setBadgeText } = installBadgeApi([
      { url: 'https://a.com/' },
      { url: 'https://b.com/', pendingUrl: 'https://a.com/' }
    ]);

    await refreshBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '1' });
  });

  it('数量超过 999 时截断（角标显示空间有限）', async () => {
    await applyBadgeMode('count');
    const tabs = Array.from({ length: 1001 }, (_, i) => ({ url: `https://s${i}.com/` }));
    const { setBadgeText } = installBadgeApi(tabs);

    await refreshBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: '999' });
  });

  it('action API 不可用时直接返回（不抛错）', async () => {
    await applyBadgeMode('count');
    (fakeBrowser as unknown as { action?: unknown }).action = undefined;

    await expect(refreshBadge()).resolves.toBeUndefined();
  });

  it('更新失败时留痕并静默（角标不阻塞其他功能）', async () => {
    await applyBadgeMode('count');
    const { query } = installBadgeApi([]);
    query.mockRejectedValue(new Error('tabs api down'));

    await refreshBadge();

    expect(readDiagnostics().some((e) => e.message.includes('工具栏角标更新失败'))).toBe(true);
  });

  it('并发刷新串行执行：最终角标等于**最后一次输入**的计算结果', async () => {
    await applyBadgeMode('count');
    // 三次刷新的查询耗时刻意排成「慢—快—中」：并行时最后落地的是最慢的第 1 次，
    // 角标于是停在过期结果上；串行时落地顺序 = 发起顺序，末值即第 3 次的计算结果。
    const batches = [
      {
        delay: 30,
        tabs: [{ url: 'https://a.com/' }, { url: 'https://b.com/' }, { url: 'https://c.com/' }]
      },
      { delay: 0, tabs: [{ url: 'https://a.com/' }] },
      { delay: 10, tabs: [{ url: 'https://a.com/' }, { url: 'https://b.com/' }] }
    ];
    let call = 0;
    const query = vi.fn(async () => {
      const batch = batches[Math.min(call, batches.length - 1)]!;
      call += 1;
      await new Promise((resolve) => setTimeout(resolve, batch.delay));
      return batch.tabs;
    });
    const { setBadgeText } = installBadgeApi([]);
    (fakeBrowser.tabs as unknown as { query: unknown }).query = query;

    void refreshBadge();
    void refreshBadge();
    void refreshBadge();
    await vi.advanceTimersByTimeAsync(100);

    expect(query).toHaveBeenCalledTimes(3);
    expect(setBadgeText.mock.calls.map((args) => args[0].text)).toEqual(['3', '1', '2']);
    expect(setBadgeText).toHaveBeenLastCalledWith({ text: '2' });
  });
});

describe('showBadgeOverride 临时角标（如「整理完成」打勾）', () => {
  it('覆盖期内显示覆盖文案，到期后回到按设置计算的角标', async () => {
    await applyBadgeMode('count');
    const { setBadgeText } = installBadgeApi([{ url: 'https://a.com/' }]);

    showBadgeOverride('✓', '#16a34a', 1500);
    await vi.advanceTimersByTimeAsync(0);
    expect(setBadgeText).toHaveBeenLastCalledWith({ text: '✓' });

    // 定时器被吞掉（SW 被回收）也不影响收敛：覆盖态自带到期时间，
    // 到期后任意一次刷新都会回到真实值，不会永久停在 ✓。
    await vi.advanceTimersByTimeAsync(1500);
    await refreshBadge();
    expect(setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
  });

  it('覆盖未到期时刷新不改写覆盖文案', async () => {
    await applyBadgeMode('count');
    const { setBadgeText } = installBadgeApi([{ url: 'https://a.com/' }]);

    showBadgeOverride('✓', '#16a34a', 5_000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await refreshBadge();

    expect(setBadgeText).toHaveBeenLastCalledWith({ text: '✓' });
  });
});

describe('refreshBadgeSoon 防抖', () => {
  it('500ms 内的多次请求合并为一次刷新', async () => {
    await applyBadgeMode('count');
    const { setBadgeText } = installBadgeApi([{ url: 'https://a.com/' }]);

    refreshBadgeSoon();
    refreshBadgeSoon();
    refreshBadgeSoon();
    expect(setBadgeText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(setBadgeText).toHaveBeenCalledTimes(1);
  });

  it('防抖窗口结束后可再次触发（不是只生效一次）', async () => {
    await applyBadgeMode('count');
    const { setBadgeText } = installBadgeApi([{ url: 'https://a.com/' }]);

    refreshBadgeSoon();
    await vi.advanceTimersByTimeAsync(500);
    refreshBadgeSoon();
    await vi.advanceTimersByTimeAsync(500);

    expect(setBadgeText).toHaveBeenCalledTimes(2);
  });
});
