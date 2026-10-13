// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AboutPage } from '@/entrypoints/about/AboutPage';
import { translate } from '@/i18n';

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
    expect(screen.getByText(translate('标签视图'))).toBeInTheDocument();
    expect(screen.getByText(translate('外观与平台'))).toBeInTheDocument();

    // 域内要点：标题与说明成对渲染（只渲染标题等于丢了说明）
    expect(screen.getByText(translate('原生标签组同步'))).toBeInTheDocument();
    expect(
      screen.getByText(
        translate(
          '面板里的分组就是浏览器的原生标签组：折叠、改名、换色都会落到浏览器，两边始终一致。'
        )
      )
    ).toBeInTheDocument();
    expect(screen.getByText(translate('诊断导出'))).toBeInTheDocument();
  });

  it('渲染快捷入口区块（右键菜单 / 地址栏 / 角标 / 命令面板 / 磁贴）', () => {
    render(<AboutPage />);

    expect(screen.getByText(translate('快捷入口'))).toBeInTheDocument();
    expect(screen.getByText(translate('右键菜单'))).toBeInTheDocument();
    expect(
      screen.getByText(
        translate('地址栏输入 t 再按 Tab，然后输关键词，直达标签、固定条目与文件夹。')
      )
    ).toBeInTheDocument();
    expect(screen.getByText(translate('常驻磁贴与固定空间'))).toBeInTheDocument();
  });

  it('渲染隐私承诺徽章与版本号', () => {
    render(<AboutPage />);

    expect(screen.getByText(translate('数据只在本机'))).toBeInTheDocument();
    expect(screen.getByText(translate('零网络请求'))).toBeInTheDocument();
    expect(
      screen.getByText(translate('版本 {{version}}', { version: '9.9.9' }))
    ).toBeInTheDocument();
  });

  it('快捷键分「面板内」与「浏览器级」两组', () => {
    render(<AboutPage />);

    const panelTitle = screen.getByText(translate('侧边栏内'));
    const globalTitle = screen.getByText(translate('浏览器级（全局）'));
    expect(panelTitle).toBeInTheDocument();
    expect(globalTitle).toBeInTheDocument();

    // 全局那组必须带「可自行修改」的说明，否则用户会以为默认键不可变
    expect(
      screen.getByText(translate('这组快捷键可在浏览器的扩展快捷键设置页自行修改。'))
    ).toBeInTheDocument();

    // 面板内：抽查两条；浏览器级：确认落在 global 那栏内
    expect(screen.getByText(translate('打开命令面板'))).toBeInTheDocument();
    const globalList = globalTitle.closest('div');
    expect(globalList).not.toBeNull();
    expect(
      within(globalList as HTMLElement).getByText(translate('打开 / 聚焦侧边栏'))
    ).toBeInTheDocument();
  });

  it('渲染隐私与数据、技术与许可两个说明区块', () => {
    render(<AboutPage />);

    expect(screen.getByText(translate('隐私与数据'))).toBeInTheDocument();
    expect(screen.getByText(translate('零出站网络请求'))).toBeInTheDocument();
    expect(screen.getByText(translate('技术与许可'))).toBeInTheDocument();
    expect(
      screen.getByText(translate('MIT 许可证开源，代码可审计，欢迎提交问题与贡献。'))
    ).toBeInTheDocument();
  });
});
