// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { SnapshotsPanel } from '@/ui/common/SnapshotsPanel';
import { useSnapshotStore } from '@/stores/snapshotStore';

/**
 * 快照面板概念收敛规格：
 * 四种 origin 混排在一个列表里时，用户无法判断对象的生命周期与恢复预期。
 * 现按「命名快照 / 归档 / 关窗自动保存」三组展示，每组语义唯一。
 */

function makeSnap(partial: Partial<Snapshot>): Snapshot {
  return {
    id: 's1',
    name: '快照',
    origin: 'manual',
    createdAt: 1,
    tabCount: 1,
    tabs: [],
    ...partial
  };
}

afterEach(() => {
  cleanup();
  useSnapshotStore.setState({ snapshots: [], ready: false });
});

describe('SnapshotsPanel 分组', () => {
  it('按生命周期分组展示，命名快照与归档不混排', () => {
    useSnapshotStore.setState({
      snapshots: [
        makeSnap({ id: 'm1', name: '我的快照', origin: 'manual', createdAt: 300 }),
        makeSnap({ id: 'a1', name: '归档现场', origin: 'archive', createdAt: 200 }),
        makeSnap({ id: 'auto1', name: '关窗自动', origin: 'auto', createdAt: 100 }),
        makeSnap({ id: 'sp1', name: '工作区', origin: 'space', createdAt: 50 })
      ],
      ready: true
    });

    render(<SnapshotsPanel onClose={() => {}} />);

    // 断言用英文文案：i18n 默认语言在测试环境下为 en（不依赖浏览器语言）。
    const groupNamed = screen.getByText('Named snapshots').closest('div');
    const groupArchive = screen.getByText('Archives (closed and kept)').closest('div');
    const groupAuto = screen.getByText('Auto-saved on window close').closest('div');

    // 命名快照组含手动快照与轻量空间快照（两者同为「用户主动保存的现场」）
    expect(groupNamed).toHaveTextContent('我的快照');
    expect(groupNamed).toHaveTextContent('工作区');
    expect(groupNamed).not.toHaveTextContent('归档现场');

    // 归档独立成组
    expect(groupArchive).toHaveTextContent('归档现场');
    expect(groupArchive).not.toHaveTextContent('我的快照');

    expect(groupAuto).toHaveTextContent('关窗自动');
  });

  it('无快照时只显示空态，不渲染任何分组标题', () => {
    render(<SnapshotsPanel onClose={() => {}} />);

    expect(screen.queryByText('Named snapshots')).toBeNull();
    expect(screen.queryByText('Archives (closed and kept)')).toBeNull();
    expect(screen.queryByText('Auto-saved on window close')).toBeNull();
    expect(i18n.isInitialized).toBe(true);
  });
});
