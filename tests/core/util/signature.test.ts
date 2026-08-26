import { describe, it, expect } from 'vitest';
import { structuralSignature } from '@/core/util/signature';

describe('structuralSignature', () => {
  it('忽略 favIconUrl，其余字段保持相等语义', () => {
    const a = { id: '1', title: 'x', favIconUrl: 'data:image1' };
    const b = { id: '1', title: 'x', favIconUrl: 'data:image2' };
    expect(structuralSignature(a)).toBe(structuralSignature(b));
  });

  it('非 favicon 字段变化时应不相等', () => {
    const a = { id: '1', title: 'x' };
    const b = { id: '1', title: 'y' };
    expect(structuralSignature(a)).not.toBe(structuralSignature(b));
  });

  it('无 favicon 时与 JSON.stringify 完全一致', () => {
    const v = { id: '1', items: [{ id: 'a', url: 'u' }] };
    expect(structuralSignature(v)).toBe(JSON.stringify(v));
  });

  it('大体积 favicon 不参与序列化，显著降低开销', () => {
    const heavy = { id: '1', favIconUrl: 'x'.repeat(10_000) };
    const sig = structuralSignature(heavy);
    expect(sig).not.toContain('xxxx');
  });
});
