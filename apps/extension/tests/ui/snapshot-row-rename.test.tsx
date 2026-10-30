// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { translate } from '@/i18n';
import type { Snapshot } from '@/core/schema/models';
import { SnapshotRow } from '@/ui/snapshot/SnapshotRow';

/**
 * 快照重命名输入的行为规格（P1-4）：Enter 提交 / Escape 取消 / 失焦提交三条路径互斥。
 *
 * 关键约束：提交或取消都会让父级卸载输入框，卸载时若输入框持有焦点会派发一次 blur。
 * 无条件 onBlur 提交会把「Escape 取消」反提交为保存、让 Enter 写两次。这里用编辑会话
 * 标尺去重，本文件锁住这条不变量。
 */

function makeSnap(): Snapshot {
  return {
    id: 's1',
    name: '旧名字',
    origin: 'manual',
    createdAt: 1,
    tabCount: 1,
    tabs: []
  };
}

function renderEditingRow() {
  const onCommitRename = vi.fn();
  const onCancelRename = vi.fn();
  const onEditingNameChange = vi.fn();
  const props = {
    snap: makeSnap(),
    isEditing: true,
    editingName: '新名字',
    isDetailOpen: false,
    onEditingNameChange,
    onBeginRename: vi.fn(),
    onCommitRename,
    onCancelRename,
    onToggleDetail: vi.fn(),
    onRestore: vi.fn(),
    onDelete: vi.fn()
  };
  render(
    <ul>
      <SnapshotRow {...props} />
    </ul>
  );
  const input = screen.getByRole('textbox', { name: translate('重命名') });
  return { input, onCommitRename, onCancelRename, onEditingNameChange };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SnapshotRow 重命名三方去重', () => {
  it('Enter 提交后，卸载派发的 blur 不再重复提交', () => {
    // Given: 处于编辑态
    const { input, onCommitRename } = renderEditingRow();

    // When: 按 Enter 提交，再模拟组件卸载时派发的 blur
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    // Then: 只提交一次（标尺挡住了 blur 的二次提交）
    expect(onCommitRename).toHaveBeenCalledTimes(1);
  });

  it('Escape 取消不会被 blur 反提交为保存', () => {
    // Given: 处于编辑态
    const { input, onCommitRename, onCancelRename } = renderEditingRow();

    // When: 按 Escape 取消，再模拟卸载派发的 blur
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);

    // Then: 只走取消，绝不触发提交
    expect(onCancelRename).toHaveBeenCalledTimes(1);
    expect(onCommitRename).not.toHaveBeenCalled();
  });

  it('真实失焦（未按 Enter/Escape）提交一次', () => {
    // Given: 处于编辑态，用户直接点别处
    const { input, onCommitRename } = renderEditingRow();

    // When: 失焦
    fireEvent.blur(input);

    // Then: 提交一次
    expect(onCommitRename).toHaveBeenCalledTimes(1);
  });

  it('提交后继续输入清空去重标尺，允许再次提交（空名失败保留编辑态的场景）', () => {
    // Given: Enter 提交后父级因空名保留编辑态
    const { input, onCommitRename, onEditingNameChange } = renderEditingRow();

    // When: Enter 提交 → 用户继续输入（onChange 重置标尺）→ 再 Enter
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '再改一次' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Then: 两次提交都被放行（输入重置了会话标尺）
    expect(onEditingNameChange).toHaveBeenCalledWith('再改一次');
    expect(onCommitRename).toHaveBeenCalledTimes(2);
  });
});
