import { describe, expect, it } from 'vitest';
import { findCspViolations } from '../../scripts/csp-policy.ts';

const VALID_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: chrome-extension:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
];
const VALID_CSP = VALID_DIRECTIVES.join('; ');

describe('extension CSP source policy', () => {
  it('允许当前构建使用的各指令来源', () => {
    expect(findCspViolations(VALID_CSP)).toEqual([]);
  });

  it.each(["'unsafe-inline'", "'none'", 'data:', 'chrome-extension:'])(
    'Given 非脚本来源 %s When 用于 script-src Then 判定为违规',
    (source) => {
      const csp = VALID_CSP.replace("script-src 'self'", `script-src 'self' ${source}`);
      expect(findCspViolations(csp)).toEqual([`script-src ${source}`]);
    }
  );

  it('只在对应指令允许 data: 与 chrome-extension:', () => {
    expect(findCspViolations(VALID_CSP)).toEqual([]);
    const csp = VALID_CSP.replace("font-src 'self'", "font-src 'self' data:");
    expect(findCspViolations(csp)).toEqual(['font-src data:']);
  });

  it('拒绝未登记 CSP 指令', () => {
    expect(findCspViolations(`${VALID_CSP}; script-src-elem data:`)).toEqual([
      'script-src-elem (未登记指令)'
    ]);
  });

  it('缺少任一必需指令时判定为违规', () => {
    const csp = VALID_DIRECTIVES.filter((directive) => !directive.startsWith('connect-src')).join(
      '; '
    );

    expect(findCspViolations(csp)).toEqual(['connect-src (缺少必需指令)']);
  });

  it.each([
    ["style-src 'self'", "style-src 'unsafe-inline' (缺少必需来源)"],
    ['img-src data: chrome-extension:', "img-src 'self' (缺少必需来源)"]
  ])('必需来源缺失时判定为违规', (replacement, violation) => {
    const name = replacement.split(' ')[0]!;
    const csp = VALID_DIRECTIVES.map((directive) =>
      directive.startsWith(`${name} `) ? replacement : directive
    ).join('; ');

    expect(findCspViolations(csp)).toEqual([violation]);
  });
});
