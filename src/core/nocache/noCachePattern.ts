/**
 * 禁缓存 pattern 的归一化与校验（纯领域逻辑，零浏览器依赖）。
 *
 * 归档在 core 的两个理由：
 *  1. `SettingsSchema`（core）需要在 schema 层完成归一化，若从 platform 引入会造成
 *     core → platform 的反向依赖；
 *  2. 归一化必须是**唯一口径**：UI 编辑、备份导入、设置同步三条入口都经
 *     SettingsSchema，写入即归一化，从而保证「能读出来的 pattern 一定可安全编译为
 *     DNR 规则」——否则一条来自备份文件的 `["https://*"]` 就能生成覆盖全站流量的
 *     modifyHeaders 规则。
 *
 * 三类形态（与 DNR 匹配语义保持一致）：
 *  1. 完整 URL 前缀 `https://example.com/app` → urlFilter 原样；
 *  2. 纯域名 `example.com` → regexFilter，匹配裸域与任意深度子域；
 *  3. 域名 + 路径 `example.com/app` → urlFilter `||example.com/app`。
 */

/** patterns 条数上限（防 DNR 动态规则配额膨胀）。 */
export const NO_CACHE_PATTERNS_LIMIT = 50;

/** 单条 pattern 的最大长度（与 SettingsSchema 的元素上限同源）。 */
export const NO_CACHE_PATTERN_MAX_LENGTH = 200;

/** 主机名合法字符（ASCII 域名 / punycode / IPv4 字面量；端口与 IPv6 走完整前缀形态）。 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
/** 路径部分允许的 URL 字符（排除空白、引号、反引号与 DNR 通配锚字符）。 */
const PATH_PATTERN = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/%]+$/;
/**
 * 形态 1 的 host 之后部分（路径 + 可选的查询串/片段）。
 * 在 PATH_PATTERN 基础上放行 `?` `#` 及其后内容——它们是 URL 前缀匹配的合法组成，
 * 且危险字符（DNR 通配/锚定语法）仍不在允许集内。
 */
const REST_PATTERN = /^[A-Za-z0-9\-._~!$&'()+,;=:@/%]*(?:[?#][A-Za-z0-9\-._~!$&'()*+,;=:@/%]*)?$/;
/** 用户输入中禁止出现的 DNR 模式语法字符（防止无意间写成通配/锚定规则）。 */
const FORBIDDEN_CHARS = /[\s|`"'^*]/;

/**
 * 归一化并校验单条 pattern。
 * @returns 规范后的 pattern；非法输入返回 null（调用方应丢弃而非透传）。
 */
export function normalizeNoCachePattern(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > NO_CACHE_PATTERN_MAX_LENGTH) return null;
  if (FORBIDDEN_CHARS.test(trimmed)) return null;

  // 形态 1：完整 URL 前缀（必须显式 http/https）。
  if (trimmed.includes('://')) {
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
      const url = new URL(trimmed);
      // scheme + host(含端口) 小写化（域名大小写不敏感），路径/查询保留用户原样。
      const rest = trimmed.slice(trimmed.indexOf('://') + 3).replace(/^[^/?#]*/, '');
      // rest 是未解析的用户原样字符串，再用 REST_PATTERN 白名单兜一层：
      // 放行 `?`/`#` 及其内容（前缀匹配的合法组成），
      // 拦下 `*`/`^`/`|`/空白等 DNR 通配与锚定语法。
      if (rest !== '' && !REST_PATTERN.test(rest)) return null;
      const normalized = `${url.protocol}//${url.host.toLowerCase()}${rest}`;
      return normalized.length <= NO_CACHE_PATTERN_MAX_LENGTH ? normalized : null;
    } catch {
      return null;
    }
  }

  const lower = trimmed.toLowerCase();

  // 形态 2：纯域名（不含路径）。
  const slashIndex = lower.indexOf('/');
  if (slashIndex === -1) {
    return HOST_PATTERN.test(lower) && !lower.includes('..') ? lower : null;
  }

  // 形态 3：域名 + 路径前缀。
  const host = lower.slice(0, slashIndex);
  const path = trimmed.slice(slashIndex);
  if (!HOST_PATTERN.test(host) || host.includes('..')) return null;
  if (!PATH_PATTERN.test(path)) return null;
  return `${host}${path}`;
}
