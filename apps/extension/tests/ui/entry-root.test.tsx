// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useDataStore } from '@/stores/dataStore';
import { EntryRoot } from '@/ui/common/EntryRoot';
import { translate } from '@/i18n';

/**
 * EntryRoot 行为规格：初始化成功后显示页面内容；初始化失败时显示错误并记录诊断，
 * 用户重试成功后进入正常视图。
 */

const logFailure = vi.fn();

vi.mock('@/platform/diagnostics', () => ({
  logFailure: (...args: unknown[]) => logFailure(...args),
  logDegraded: vi.fn()
}));

// 同步设置属于设置页/关于页各自的职责，此处只关心「初始化 + 失败兜底」。
vi.mock('@/ui/common/SettingsSync', () => ({ SettingsSync: () => null }));

/** 内容探针：渲染出来即代表「初始化成功后进入了正常视图」。 */
function Content() {
  return <p>已就绪</p>;
}

function stubInitialize(impl: () => Promise<void>) {
  useDataStore.setState({ initialize: impl } as never);
}

describe('EntryRoot', () => {
  beforeEach(() => {
    logFailure.mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  it('初始化成功：渲染传入的内容', async () => {
    stubInitialize(async () => undefined);
    render(
      <EntryRoot scope="options">
        <Content />
      </EntryRoot>
    );
    await waitFor(() => expect(screen.getByText('已就绪')).toBeInTheDocument());
  });

  it('初始化失败：显示失败态并留痕（不留无反馈的空白页）', async () => {
    const failure = new Error('storage unavailable');
    stubInitialize(async () => {
      throw failure;
    });
    render(
      <EntryRoot scope="options">
        <Content />
      </EntryRoot>
    );
    await waitFor(() => expect(screen.getByText(translate('数据加载失败'))).toBeInTheDocument());
    expect(logFailure).toHaveBeenCalledWith('options', expect.any(String), failure);
    expect(screen.queryByText('已就绪')).not.toBeInTheDocument();
  });

  it('失败态点重试：重新初始化，成功后进入正常视图', async () => {
    let attempt = 0;
    stubInitialize(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('first attempt fails');
    });
    render(
      <EntryRoot scope="about">
        <Content />
      </EntryRoot>
    );
    await waitFor(() => expect(screen.getByText(translate('数据加载失败'))).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: translate('重试') }));
    await waitFor(() => expect(screen.getByText('已就绪')).toBeInTheDocument());
    expect(attempt).toBe(2);
  });
});
