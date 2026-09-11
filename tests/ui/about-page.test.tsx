// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AboutPage } from '@/entrypoints/about/AboutPage';
import i18n from '@/i18n';

// platform 依赖打桩：关于页只读取版本号，不触碰真实 browser API
vi.mock('@/platform/navigation', () => ({
  getExtensionVersion: () => '9.9.9',
  openAboutPage: vi.fn(),
  openUrlInTab: vi.fn()
}));

/**
 * 关于页（能力总览）冒烟。
 *
 * 价值点：i18n 死键守卫保证「文案存在」，本测试保证「页面真的把它们用上了」——
 * 两者互补。能力域与要点由静态键数组驱动，漏渲染/漏登记会在这里暴露。
 */
describe('关于页（能力总览）', () => {
  afterEach(() => cleanup());

  it('渲染能力域（抽查首尾域与域内要点）', () => {
    render(<AboutPage />);

    // 能力域首尾（中间项由同一数组驱动，漏项会破坏长度直觉）
    expect(screen.getByText(i18n.t('about.domTabsTitle'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.domLookTitle'))).toBeInTheDocument();

    // 域内要点：标题与说明成对渲染（只渲染标题等于丢了说明）
    expect(screen.getByText(i18n.t('about.domTabs1Title'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.domTabs1Body'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.domData4Title'))).toBeInTheDocument();
  });

  it('渲染快捷入口区块（右键菜单 / 地址栏 / 角标 / 命令面板 / 磁贴）', () => {
    render(<AboutPage />);

    expect(screen.getByText(i18n.t('about.entryPointsTitle'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.entry1Title'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.entry2Body'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.entry5Title'))).toBeInTheDocument();
  });

  it('渲染隐私承诺徽章与版本号', () => {
    render(<AboutPage />);

    expect(screen.getByText(i18n.t('about.badgeLocal'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.badgeNoNetwork'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.version', { version: '9.9.9' }))).toBeInTheDocument();
  });

  it('快捷键分「面板内」与「浏览器级」两组', () => {
    render(<AboutPage />);

    const panelTitle = screen.getByText(i18n.t('about.panelShortcutsTitle'));
    const globalTitle = screen.getByText(i18n.t('about.globalShortcutsTitle'));
    expect(panelTitle).toBeInTheDocument();
    expect(globalTitle).toBeInTheDocument();

    // 全局那组必须带「可自行修改」的说明，否则用户会以为默认键不可变
    expect(screen.getByText(i18n.t('about.globalShortcutsHint'))).toBeInTheDocument();

    // 面板内：抽查两条；浏览器级：确认落在 global 那栏内
    expect(screen.getByText(i18n.t('about.shortcutPalette'))).toBeInTheDocument();
    const globalList = globalTitle.closest('div');
    expect(globalList).not.toBeNull();
    expect(
      within(globalList as HTMLElement).getByText(i18n.t('about.globalOpenPanel'))
    ).toBeInTheDocument();
  });

  it('渲染隐私与数据、技术与许可两个说明区块', () => {
    render(<AboutPage />);

    expect(screen.getByText(i18n.t('about.privacyTitle'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.privacy2Title'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.techTitle'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('about.tech3Body'))).toBeInTheDocument();
  });
});
