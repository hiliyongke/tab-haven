// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { translate } from '@/i18n';
import { DEFAULT_SETTINGS } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';
import { MirrorSyncStatus } from '@/entrypoints/options/settingSections';

/**
 * 跨设备同步状态的行为规格。
 *
 * 为什么逐态断言：这一行的价值全在「同一件事的五种成因说五句不同的话」。
 * 三元链的最后一态是「其他」兜底 —— 将来 `MirrorPullIssue` 新增取值会
 * 静默归到「镜像损坏或已过期」，而测试仍全绿。这里把五态各钉一句文案，
 * 新增枚举时「补文案」才会变成一次失败的测试而非一次静默的误报。
 */

type PullIssue = 'ok' | 'none' | 'local' | 'chunk-limit' | 'unreadable';

function renderStatus(state: {
  issue?: PullIssue | null;
  writeFailed?: boolean;
  quotaExceeded?: boolean;
  enabled?: boolean;
}) {
  useDataStore.setState({
    settings: { ...DEFAULT_SETTINGS, syncMirrorEnabled: state.enabled ?? true },
    mirrorIssue: state.issue ?? null,
    mirrorWriteFailed: state.writeFailed ?? false,
    mirrorQuotaExceeded: state.quotaExceeded ?? false
  });
  return render(<MirrorSyncStatus t={(key: string) => translate(key)} />);
}

afterEach(() => {
  cleanup();
  // 复位 store，避免用例间状态残留（与 settings-page.test.tsx 同口径）。
  useDataStore.setState({
    settings: DEFAULT_SETTINGS,
    mirrorIssue: null,
    mirrorWriteFailed: false,
    mirrorQuotaExceeded: false
  });
});

describe('MirrorSyncStatus 五态映射', () => {
  it('本机数据为准（本次同步未从镜像恢复）：给中性说明且不标红', () => {
    // 与 'none' 必须分开：'none' 说「尚未生成镜像」，而此处云端镜像**确实存在**
    // （只是本机数据非空、以本地为准），沿用它会给出与事实相反的说法。
    const { container } = renderStatus({ issue: 'local' });

    expect(container).toHaveTextContent('Local data takes precedence');
    // 标红意味着「同步没生效」，而这里不是故障，只是本次同步没有从镜像取数据。
    expect(container.querySelector('.text-red-600')).toBeNull();
  });

  it('写入失败：说「本次改动未上传」（即使拉取结果是 ok —— 云端留的是旧镜像）', () => {
    const { container } = renderStatus({ issue: 'ok', writeFailed: true });

    expect(container).toHaveTextContent(
      translate('未生效（本次改动未上传）：其他设备不会收到这份数据')
    );
  });

  it('写入失败且容量超限：说「超出同步容量上限」（与 PRIVACY.md §4 同口径）', () => {
    // 写侧已用与 pull 同一把尺子拦截，超配额时「超出容量上限」若只由 pull 触发，
    // 用户看到的就是「本次改动未上传」——那句会让人以为重试即可成功。
    const { container } = renderStatus({
      issue: 'ok',
      writeFailed: true,
      quotaExceeded: true
    });

    expect(container).toHaveTextContent(
      translate('未生效（超出同步容量上限）：其他设备不会收到这份数据')
    );
    expect(container).not.toHaveTextContent(translate('未生效（本次改动未上传）'));
  });

  it('拉取成功：说「已生效」', () => {
    const { container } = renderStatus({ issue: 'ok' });

    expect(container).toHaveTextContent(translate('已生效'));
  });

  it('尚无镜像：说「尚未生成镜像」而不是「已生效」', () => {
    const { container } = renderStatus({ issue: 'none' });

    expect(container).toHaveTextContent(translate('尚未生成镜像（本机数据将成为首份镜像）'));
  });

  it('超出容量上限：说「超出同步容量上限」而不是「镜像损坏」', () => {
    const { container } = renderStatus({ issue: 'chunk-limit' });

    expect(container).toHaveTextContent(
      translate('未生效（超出同步容量上限）：其他设备不会收到这份数据')
    );
  });

  it('镜像不可读：说「镜像损坏或已过期」', () => {
    const { container } = renderStatus({ issue: 'unreadable' });

    expect(container).toHaveTextContent(
      translate('未生效（镜像损坏或已过期）：其他设备不会收到这份数据')
    );
  });
});

describe('MirrorSyncStatus 不渲染的两种情形', () => {
  /** 关着同步的用户看到一句关于镜像的警告只会困惑（对他们而言镜像本就不存在）。 */
  it('同步未开启时不渲染（含拉取失败态）', () => {
    const { container } = renderStatus({ issue: 'unreadable', enabled: false });

    expect(container).toBeEmptyDOMElement();
  });

  /** 没有依据却显示「已生效」是把猜测当事实；写失败是例外（它是本次会话的真实结果）。 */
  it('本会话未拉取过镜像且写未失败时不渲染', () => {
    const { container } = renderStatus({ issue: null, writeFailed: false });

    expect(container).toBeEmptyDOMElement();
  });
});
