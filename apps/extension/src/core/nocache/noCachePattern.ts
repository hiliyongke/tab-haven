/**
 * 禁缓存 pattern 的归一化与校验（纯领域逻辑，零浏览器依赖）。
 * 放在 core 供 `SettingsSchema` 在 schema 层归一化（避免 core → platform 反向依赖），三条入口写入即归一化，保证「能读出的 pattern 一定可安全编译为 DNR 规则」——否则备份里一条 `["https://*"]` 就能覆盖全站。
 * 三类形态：完整 URL 前缀 → urlFilter 原样；纯域名 → regexFilter（匹配裸域与子域）；域名 + 路径 → urlFilter `||example.com/app`。
 */

import { isHttpUrl } from '@/core/url/UrlInspector';

/** patterns 条数上限（防 DNR 动态规则配额膨胀）。 */
export const NO_CACHE_PATTERNS_LIMIT = 50;

/** 单条 pattern 的最大长度（与 SettingsSchema 的元素上限同源）。 */
export const NO_CACHE_PATTERN_MAX_LENGTH = 200;

/** 主机名合法字符（ASCII 域名 / punycode / IPv4 字面量；端口与 IPv6 走完整前缀形态）。 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
/** 路径部分允许的 URL 字符（排除空白、引号、反引号与 DNR 通配锚字符）。 */
const PATH_PATTERN = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/%]+$/;
/** 形态 1 host 之后部分（路径 + 可选查询串/片段）：在 PATH_PATTERN 基础上放行 `?` `#` 及其后内容，但不含 DNR 通配/锚定危险字符。 */
const REST_PATTERN = /^[A-Za-z0-9\-._~!$&'()+,;=:@/%]*(?:[?#][A-Za-z0-9\-._~!$&'()*+,;=:@/%]*)?$/;
/** 用户输入中禁止出现的 DNR 模式语法字符（防止无意间写成通配/锚定规则）。 */
const FORBIDDEN_CHARS = /[\s|`"'^*]/;

/** 归一化并校验单条 pattern。@returns 规范后的 pattern；非法输入返回 null（调用方应丢弃而非透传）。 */
export function normalizeNoCachePattern(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > NO_CACHE_PATTERN_MAX_LENGTH) return null;
  if (FORBIDDEN_CHARS.test(trimmed)) return null;

  if (trimmed.includes('://')) {
    if (!isHttpUrl(trimmed)) return null;
    try {
      const url = new URL(trimmed);
      // 带 userinfo 的 URL 直接拒绝：`url.host` 不含凭据，归一化会把 `https://u:p@example.com` 变成 `https://example.com`，规则被静默放大到全站。
      if (url.username || url.password) return null;
      // scheme + host 小写化，路径/查询保留原样；刻意不复用 normalizeHostname——「去 www」会改变用户手填匹配式的意图（www.a.com 与 a.com 应是两条不同规则）。
      const rest = trimmed.slice(trimmed.indexOf('://') + 3).replace(/^[^/?#]*/, '');
      // rest 未解析，再用 REST_PATTERN 白名单放行 `?`/`#` 及其内容、拦下 `*`/`^`/`|`/空白等 DNR 通配与锚定语法。
      if (rest !== '' && !REST_PATTERN.test(rest)) return null;
      const normalized = `${url.protocol}//${url.host.toLowerCase()}${rest}`;
      return normalized.length <= NO_CACHE_PATTERN_MAX_LENGTH ? normalized : null;
    } catch {
      return null;
    }
  }

  const lower = trimmed.toLowerCase();

  const slashIndex = lower.indexOf('/');
  if (slashIndex === -1) {
    // 单标签主机必须拒绝：`com` / `io` 这类裸 TLD 会编译成对整个顶级域强制 no-store 的规则。
    // 唯一放行的单标签主机是 localhost（对本机服务禁缓存的合法需求）。
    if (!lower.includes('.') && lower !== 'localhost') return null;
    return HOST_PATTERN.test(lower) && !lower.includes('..') ? lower : null;
  }

  const host = lower.slice(0, slashIndex);
  const path = trimmed.slice(slashIndex);
  if (!HOST_PATTERN.test(host) || host.includes('..')) return null;
  if (!PATH_PATTERN.test(path)) return null;
  return `${host}${path}`;
}
