// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { translate } from '@/i18n';
import { NoCachePatternEditor, WhitelistEditor } from '@/ui/settings/settingControls';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('设置编辑器 IME 组合态', () => {
  it('白名单输入在组合态下按 Enter 不添加条目', () => {
    const onChange = vi.fn();
    render(<WhitelistEditor value={[]} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: translate('输入域名') });
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['example.com']);
  });

  it('禁缓存文本域在组合态下按 Cmd+Enter 不保存', () => {
    const onChange = vi.fn();
    render(<NoCachePatternEditor value={[]} onChange={onChange} />);
    const textarea = screen.getByRole('textbox', { name: translate('禁缓存站点列表') });
    fireEvent.change(textarea, { target: { value: 'example.com' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true, isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onChange).toHaveBeenCalledWith(['example.com']);
  });
});
