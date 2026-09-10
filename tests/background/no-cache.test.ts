import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, type Settings } from '@/core/schema/models';
import { clearDiagnostics, readDiagnostics } from '@/platform/diagnostics';
import { syncNoCacheRules } from '@/entrypoints/background/noCache';

/**
 * 开发者禁缓存（DNR 动态规则同步）。
 *
 * 三条闸门必须**同时**成立才注入规则：开关开 + 已授权 `<all_urls>` + 有 pattern。
 * 少任何一条都不得注入 —— 未授权时注入等于「规则静默不生效」，
 * 而 DNR 同步失败本身也必须进诊断（否则禁缓存能力静默失效、用户完全无从察觉）。
 */

interface DnrRule {
  id: number;
}

function installDnr(existing: DnrRule[] = []) {
  const updateDynamicRules = vi.fn<(details?: unknown) => Promise<void>>(async () => undefined);
  const getDynamicRules = vi.fn(async () => existing);
  (fakeBrowser as unknown as { declarativeNetRequest?: unknown }).declarativeNetRequest = {
    getDynamicRules,
    updateDynamicRules
  };
  return { getDynamicRules, updateDynamicRules };
}

function installPermission(granted: boolean) {
  (fakeBrowser as unknown as { permissions?: unknown }).permissions = {
    contains: vi.fn(async () => granted)
  };
}

function settingsWith(partial: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...partial };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  fakeBrowser.reset();
  (fakeBrowser as unknown as { declarativeNetRequest?: unknown }).declarativeNetRequest = undefined;
  (fakeBrowser as unknown as { permissions?: unknown }).permissions = undefined;
  clearDiagnostics();
  vi.restoreAllMocks();
});

describe('syncNoCacheRules 注入闸门', () => {
  it('开关开 + 已授权 + 有 pattern：注入规则并清掉旧的动态规则', async () => {
    installPermission(true);
    const { updateDynamicRules } = installDnr([{ id: 7 }, { id: 8 }]);

    await syncNoCacheRules(
      settingsWith({ noCacheEnabled: true, noCachePatterns: ['https://a.com/'] })
    );

    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    const call = updateDynamicRules.mock.calls[0]![0] as unknown as {
      removeRuleIds: number[];
      addRules: unknown[];
    };
    expect(call.removeRuleIds.sort()).toEqual([7, 8]);
    expect(call.addRules.length).toBeGreaterThan(0);
  });

  it('未授权主机权限时不注入（注入也不会生效，属静默失效）', async () => {
    installPermission(false);
    const { updateDynamicRules } = installDnr([]);

    await syncNoCacheRules(
      settingsWith({ noCacheEnabled: true, noCachePatterns: ['https://a.com/'] })
    );

    // 无旧规则且无新规则 → 完全不必调用 API
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });

  it('开关关闭时不注入，但仍清除已注入的旧规则', async () => {
    installPermission(true);
    const { updateDynamicRules } = installDnr([{ id: 1 }]);

    await syncNoCacheRules(
      settingsWith({ noCacheEnabled: false, noCachePatterns: ['https://a.com/'] })
    );

    const call = updateDynamicRules.mock.calls[0]![0] as unknown as {
      removeRuleIds: number[];
      addRules: unknown[];
    };
    expect(call.removeRuleIds).toEqual([1]);
    expect(call.addRules).toEqual([]);
  });

  it('开关开但 pattern 为空：不注入空规则集', async () => {
    installPermission(true);
    const { updateDynamicRules } = installDnr([]);

    await syncNoCacheRules(settingsWith({ noCacheEnabled: true, noCachePatterns: [] }));

    expect(updateDynamicRules).not.toHaveBeenCalled();
  });

  it('无任何变化时不调用 updateDynamicRules（免去无谓的写配额消耗）', async () => {
    installPermission(true);
    const { updateDynamicRules } = installDnr([]);

    await syncNoCacheRules(settingsWith({ noCacheEnabled: false, noCachePatterns: [] }));

    expect(updateDynamicRules).not.toHaveBeenCalled();
  });

  it('同步失败必须留痕（禁缓存能力静默失效无从排查）', async () => {
    installPermission(true);
    const api = fakeBrowser as unknown as { declarativeNetRequest?: unknown };
    api.declarativeNetRequest = {
      getDynamicRules: vi.fn(async () => {
        throw new Error('dnr unavailable');
      }),
      updateDynamicRules: vi.fn()
    };

    await expect(
      syncNoCacheRules(settingsWith({ noCacheEnabled: true, noCachePatterns: ['https://a.com/'] }))
    ).resolves.toBeUndefined();

    expect(readDiagnostics().some((e) => e.message.includes('禁缓存规则同步失败'))).toBe(true);
  });
});
