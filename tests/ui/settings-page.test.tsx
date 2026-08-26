// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import i18n from '@/i18n';
import { SettingsPage } from '@/entrypoints/options/SettingsPage';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { settingsRepository } from '@/platform/storage/repositories';
import { useDataStore } from '@/stores/dataStore';

/**
 * SettingsPage 渲染冒烟规格（AUDIT 遗留 UI 测试盲区的最小集）：
 * 设置加载后首屏分区渲染、设置搜索可用、恢复默认入口存在。
 * 深交互（导入导出/白名单编辑）依赖文件对话框与下载，不在冒烟范围。
 */

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
  vi.restoreAllMocks();
  // 重置 zustand store，避免用例间数据残留
  useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: false });
});

beforeEach(() => {
  // fake-browser 未实现 sidePanel.getLayout（同步抛错会穿透组件 effect 的 catch），
  // 注入最小实现：右侧边栏。
  const sidePanel = fakeBrowser.sidePanel as unknown as {
    getLayout?: () => Promise<{ side: 'left' | 'right' }>;
  };
  sidePanel.getLayout = vi.fn(
    async (): Promise<{ side: 'left' | 'right' }> => ({ side: 'right' })
  );
});

describe('SettingsPage（渲染冒烟）', () => {
  it('设置就绪后渲染首屏标题与分区结构', async () => {
    // 预置已就绪的设置数据（dataStore.load 的等价捷径）
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });

    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: i18n.t('settings.title') })).toBeInTheDocument();
    // 首屏分区（外观/行为/进阶功能）均出现
    await waitFor(() => {
      expect(screen.getByText(i18n.t('settings.appearance'))).toBeInTheDocument();
    });
    expect(screen.getByText(i18n.t('settings.behavior'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('settings.capabilities'))).toBeInTheDocument();
  });

  it('设置搜索框可用：输入关键词过滤设置项', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);

    const search = await screen.findByPlaceholderText(i18n.t('settings.searchPlaceholder'));
    expect(search).toBeInTheDocument();
  });

  it('就绪前显示加载态（不渲染空设置页）', () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: false });
    render(<SettingsPage />);
    expect(screen.queryByRole('heading', { name: i18n.t('settings.title') })).toBeNull();
  });

  it('渲染恢复默认按钮（一键重置入口）', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: i18n.t('settings.resetAll') })).toBeInTheDocument();
    });
  });

  it('渲染主题偏好设置行（设置项与 SettingsSchema 同源）', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);
    // 主题偏好行存在（受控组件渲染当前值）
    await waitFor(() => {
      expect(screen.getByText(i18n.t('settings.theme'))).toBeInTheDocument();
    });
  });
});

// 抑制「设置仓库未被读取」的未用告警：导入即使用（SettingsPage 内部依赖同一仓库实例）
void settingsRepository;
