/**
 * Punycode（RFC 3492 bootstring）解码：把 IDN 的 xn-- 前缀标签还原为 Unicode。
 *
 * 用途：WHATWG URL 的 hostname 对国际化域名返回 punycode（如 中文.cn → xn--fiq228c.cn），
 * 归组键/身份键保留 punycode 形态（比较稳定），展示标签经本模块转回可读文本。
 *
 * 仅实现 decode（展示场景足够）；解码失败回退原始标签，绝不抛异常。
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = '-';

function digitValue(codePoint: number): number {
  // a-z / A-Z → 0-25；0-9 → 26-35
  if (codePoint >= 48 && codePoint <= 57) return codePoint - 48 + 26;
  if (codePoint >= 97 && codePoint <= 122) return codePoint - 97;
  if (codePoint >= 65 && codePoint <= 90) return codePoint - 65;
  throw new Error('invalid punycode digit');
}

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > Math.floor(((BASE - TMIN) * TMAX) / 2)) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** 解码单个 punycode 标签（不含 xn-- 前缀）。失败抛错，由调用方兜底。 */
function decodeLabel(input: string): string {
  const output: number[] = [];
  let index = 0;
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;

  const basicLength = input.lastIndexOf(DELIMITER);
  if (basicLength > 0) {
    for (const ch of input.slice(0, basicLength)) {
      const cp = ch.codePointAt(0)!;
      if (cp > 127) throw new Error('punycode basic segment must be ASCII');
      output.push(cp);
    }
    index = basicLength + 1;
  }

  while (index < input.length) {
    const oldI = i;
    let w = 1;
    let k = BASE;
    for (;;) {
      if (index >= input.length) throw new Error('truncated punycode');
      const digit = digitValue(input.charCodeAt(index));
      index += 1;
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      k += BASE;
    }
    const outLength = output.length + 1;
    bias = adapt(i - oldI, outLength, oldI === 0);
    n += Math.floor(i / outLength);
    i %= outLength;
    output.splice(i, 0, n);
    i += 1;
  }

  return String.fromCodePoint(...output);
}

/**
 * 域名的 punycode → Unicode（逐标签解码 xn-- 前缀标签，其余原样保留）。
 * 任何一步失败都回退为原始 hostname（展示层安全兜底）。
 */
export function domainToUnicode(hostname: string): string {
  if (!hostname.includes('xn--')) return hostname;
  try {
    return hostname
      .split('.')
      .map((label) => (label.toLowerCase().startsWith('xn--') ? decodeLabel(label.slice(4)) : label))
      .join('.');
  } catch {
    return hostname;
  }
}
