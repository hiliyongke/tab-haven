import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

function networkPatterns(): RegExp[] {
  const source = readFileSync(`${root}scripts/privacy-check.mjs`, 'utf8');
  const block = source.match(/const NETWORK_PATTERNS = \[([\s\S]*?)\n\];/)?.[1];
  expect(block).toBeDefined();
  return [...(block ?? '').matchAll(/^\s{2}(\/.*?\/[gimsuy]*),?\s*$/gm)].map((match) => {
    const literal = match[1];
    expect(literal).toBeDefined();
    const body = literal!.slice(1, literal!.lastIndexOf('/'));
    const flags = literal!.slice(literal!.lastIndexOf('/') + 1);
    return new RegExp(body, flags);
  });
}

describe('隐私检查的网络 API 规则', () => {
  it('拦截直接、可选链与逗号表达式形式的 fetch 调用', () => {
    const patterns = networkPatterns();

    for (const source of ["fetch('/api')", "fetch?.('/api')", "(0, fetch)('/api')"]) {
      expect(
        patterns.some((pattern) => pattern.test(source)),
        source
      ).toBe(true);
    }
  });

  it('不把普通标识符或说明性文本判为网络调用', () => {
    const patterns = networkPatterns();

    for (const source of ["fetcher('/api')", 'const label = fetchStatus;']) {
      expect(
        patterns.some((pattern) => pattern.test(source)),
        source
      ).toBe(false);
    }
  });
});
