import { describe, it, expect } from 'vitest';
import { structuralSignature } from '@/core/util/signature';

describe('structuralSignature', () => {
  it('favicon 变化必须可感知（不能「忽略」到永不刷新）', () => {
    const a = { id: '1', title: 'x', favIconUrl: 'data:image1' };
    const b = { id: '1', title: 'x', favIconUrl: 'data:image2' };
    expect(structuralSignature(a)).not.toBe(structuralSignature(b));
  });

  it('常见 DJB2 碰撞的不同 favicon 仍产生不同签名', () => {
    const a = { favIconUrl: 'Ab' };
    const b = { favIconUrl: 'BA' };
    expect(structuralSignature(a)).not.toBe(structuralSignature(b));
  });

  it('favicon 相同则签名相同（只比内容，不比引用）', () => {
    const a = { id: '1', title: 'x', favIconUrl: 'data:image1' };
    const b = { id: '1', title: 'x', favIconUrl: 'data:image1' };
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

  it('undefined 输入仍返回字符串（返回类型不撒谎）', () => {
    // JSON.stringify(undefined) 返回 undefined：声明 string 却返回 undefined 时，
    // 判等会静默变成 true，进而跳过本该落盘的写入。
    const sig = structuralSignature(undefined);
    expect(typeof sig).toBe('string');
    expect(sig).toBe('undefined');
    // 且不与任何真实序列化结果相等（判等语义仍然成立）
    expect(sig).not.toBe(structuralSignature({}));
    expect(sig).not.toBe(structuralSignature(null));
  });

  it('大体积 favicon 折叠成定长摘要，显著降低序列化开销', () => {
    const heavy = { id: '1', favIconUrl: 'x'.repeat(10_000) };
    const sig = structuralSignature(heavy);
    expect(sig).not.toContain('xxxx');
    // 摘要定长：长度不随 favicon 体积增长（否则大标签量下的每次比较仍在拷大字符串）
    expect(sig.length).toBeLessThan(60);
  });
});
