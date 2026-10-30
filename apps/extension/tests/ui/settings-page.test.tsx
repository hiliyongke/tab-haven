// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { translate } from '@/i18n';
import { SettingsPage } from '@/entrypoints/options/SettingsPage';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { settingsRepository } from '@/platform/storage/repositories';
import { useDataStore } from '@/stores/dataStore';
import { ImportDataError } from '@/stores/data/transferSlice';

/**
 * SettingsPage 行为规格：首屏分区与设置搜索、恢复默认入口，以及导入回滚结果反馈。
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
  sidePanel.getLayout = vi.fn(async (): Promise<{ side: 'left' | 'right' }> => ({ side: 'right' }));
});

/**
 * 分区标题的可访问名含计数徽章（如「外观 8」），且侧栏目录里有同名链接，
 * 故按 role + 前缀匹配定位标题本身。
 */
function sectionHeading(text: string): HTMLElement {
  return screen.getByRole('heading', { name: (name) => name.startsWith(translate(text)) });
}

describe('SettingsPage（渲染冒烟）', () => {
  it('设置就绪后渲染首屏标题与分区结构', async () => {
    // 预置已就绪的设置数据（dataStore.load 的等价捷径）
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });

    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: translate('设置') })).toBeInTheDocument();
    // 首屏分区（外观/行为/休眠内存/分组搜索/高级恢复）均以标题形式出现。
    // 用 heading role + 前缀匹配：分区标题内含计数徽章（如「外观 8」），
    // 且侧栏目录里有同名链接，纯 getByText 会命中多个元素。
    await waitFor(() => {
      expect(sectionHeading('外观与布局')).toBeInTheDocument();
    });
    for (const text of ['交互行为', '休眠与内存', '分组与搜索', '高级与恢复']) {
      expect(sectionHeading(text)).toBeInTheDocument();
    }
  });

  it('侧栏目录列出分区并锚点直达；分区不再折叠', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);

    const outline = await screen.findByRole('navigation', { name: translate('目录') });
    expect(within(outline).getByRole('link', { name: translate('高级与恢复') })).toHaveAttribute(
      'href',
      '#settings.advanced'
    );

    // 折叠机制已取消（目录接管了导航职责）：页面不应再有 details 元素，
    // 「高级与恢复」的内容直接可见。
    expect(document.querySelector('details')).toBeNull();
    expect(screen.getByText(translate('工具栏角标'), { exact: false })).toBeInTheDocument();
  });

  it('设置搜索只显示匹配项，无匹配时隐藏设置并展示空态', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);

    const search = await screen.findByPlaceholderText(translate('搜索设置…'));
    const matchingSetting = translate('搜索扩展到所有窗口');
    const nonmatchingSetting = translate('显示网址');

    fireEvent.change(search, { target: { value: matchingSetting } });
    await waitFor(() => {
      expect(screen.getByText(matchingSetting, { exact: true })).toBeInTheDocument();
      expect(screen.queryByText(nonmatchingSetting, { exact: true })).not.toBeInTheDocument();
    });

    fireEvent.change(search, { target: { value: '绝不可能命中的设置' } });
    await waitFor(() => {
      expect(screen.getByText(translate('没有找到匹配的设置'))).toBeInTheDocument();
      expect(screen.queryByText(matchingSetting, { exact: true })).not.toBeInTheDocument();
      expect(screen.queryByText(nonmatchingSetting, { exact: true })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: translate('数据备份') })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: translate('关于 Tabs') })
      ).not.toBeInTheDocument();
      const outline = screen.getByRole('navigation', { name: translate('目录') });
      expect(within(outline).queryAllByRole('link')).toHaveLength(0);
    });
  });

  it('静态区块的正文与目录共享搜索可见集合', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);

    const search = await screen.findByPlaceholderText(translate('搜索设置…'));
    fireEvent.change(search, { target: { value: translate('数据备份') } });

    await waitFor(() => expect(sectionHeading('数据备份')).toBeInTheDocument());
    const outline = screen.getByRole('navigation', { name: translate('目录') });
    expect(within(outline).getByRole('link', { name: translate('数据备份') })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: translate('关于 Tabs') })).not.toBeInTheDocument();
    expect(
      within(outline).queryByRole('link', { name: translate('关于 Tabs') })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(translate('没有找到匹配的设置'))).not.toBeInTheDocument();
  });

  it('自定义设置行的 hint 也参与搜索（跨设备同步可按说明命中）', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);

    const search = await screen.findByPlaceholderText(translate('搜索设置…'));
    const customHint = translate(
      '默认关闭。开启后，文件夹、常驻磁贴与设置会镜像到你浏览器账号的同步通道（Tabs 没有自己的服务器）；关闭时会一并删除已上传的数据'
    );
    fireEvent.change(search, { target: { value: customHint } });

    await waitFor(() => {
      expect(screen.getByText(translate('跨设备同步'), { exact: true })).toBeInTheDocument();
      expect(screen.queryByText(translate('显示网址'), { exact: true })).not.toBeInTheDocument();
    });
  });

  it('就绪前显示加载态（不渲染空设置页）', () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: false });
    render(<SettingsPage />);
    expect(screen.queryByRole('heading', { name: translate('设置') })).toBeNull();
  });

  it('渲染恢复默认按钮（一键重置入口）', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: translate('恢复默认') })).toBeInTheDocument();
    });
  });

  it('渲染主题偏好设置行（设置项与 SettingsSchema 同源）', async () => {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    render(<SettingsPage />);
    // 主题偏好行存在（受控组件渲染当前值）
    await waitFor(() => {
      expect(screen.getByText(translate('主题'))).toBeInTheDocument();
    });
  });
});

describe('SettingsPage 导入回滚结果反馈', () => {
  async function confirmImportFailure(error: Error): Promise<void> {
    useDataStore.setState({ settings: DEFAULT_SETTINGS, ready: true });
    vi.spyOn(useDataStore.getState(), 'importData').mockRejectedValue(error);
    const { container } = render(<SettingsPage />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: { files: [new File(['{}'], 'backup.json', { type: 'application/json' })] }
    });
    const dialog = await screen.findByRole('dialog', { name: translate('导入备份') });
    fireEvent.click(within(dialog).getByRole('button', { name: translate('导入') }));
  }

  it('结构化错误明确回滚完整时才提示本地保持导入前', async () => {
    await confirmImportFailure(new ImportDataError('snapshots', []));

    expect(
      await screen.findByText(
        translate(
          '导入失败：写入「{{name}}」时存储不可用，已回滚（本地数据保持导入前的状态）。请确认浏览器存储空间后重试。',
          { name: translate('快照') }
        )
      )
    ).toBeInTheDocument();
  });

  it('回滚存在失败分区时披露混合状态而不宣称完整回滚', async () => {
    await confirmImportFailure(new ImportDataError('snapshots', ['folders', 'settings']));

    expect(
      await screen.findByText(
        translate(
          '导入失败：写入「{{name}}」时存储不可用；回滚未完成的分区：{{partitions}}。本地数据可能处于混合状态，请勿重复导入。',
          {
            name: translate('快照'),
            partitions: `${translate('收藏夹')}, ${translate('设置')}`
          }
        )
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/本地数据保持导入前的状态/)).not.toBeInTheDocument();
  });

  it('缺少结构化回滚信息时披露无法确认回滚完整性', async () => {
    await confirmImportFailure(new Error('import-write-failed:snapshots'));

    expect(
      await screen.findByText(
        translate(
          '导入失败：写入「{{name}}」时存储不可用，且无法确认回滚是否完整。本地数据可能处于混合状态，请勿重复导入。',
          { name: translate('快照') }
        )
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/本地数据保持导入前的状态/)).not.toBeInTheDocument();
  });
});

// 抑制「设置仓库未被读取」的未用告警：导入即使用（SettingsPage 内部依赖同一仓库实例）
void settingsRepository;
