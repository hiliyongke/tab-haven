/**
 * 开发者能力：指定站点 / URL 前缀禁用前端缓存（FR：no-cache 站点规则）。
 *
 * 纯逻辑层（无浏览器 API 依赖，可单测）：
 *  - `normalizeNoCachePattern`：用户输入 → 规范 pattern（三类形态）；
 *  - `matchesNoCachePattern`：URL 是否命中 pattern（侧边栏角标与规则生效共用同一口径）；
 *  - `buildNoCacheDnrRules`：patterns → declarativeNetRequest 动态规则。
 *
 * 禁缓存双通道（关键：二者缺一不可）：
 *  - 请求头 `Cache-Control: no-cache`——与 DevTools「Disable cache」同款实现：
 *    缓存层在发请求前看到 no-cache 即绕过本地缓存（含未过期条目），强制重新验证；
 *    若只改响应头，已在缓存中的资源不产生网络请求，规则无从触发（表现为「不生效」）；
 *  - 响应头强制 no-store + 移除 ETag/Last-Modified——新响应不落盘、协商标识失效，
 *    下次请求连 304 验证条目都不存在，直接完整拉取。
 *
 * pattern 三类形态（与 DNR 匹配语义保持一致）：
 *  1. 完整前缀 `https://example.com/app` → urlFilter 原样（scheme 精确 + 前缀匹配）；
 *  2. 纯域名 `example.com` → regexFilter（裸域 + 任意深度子域，http/https 均命中）；
 *  3. 域名+路径 `example.com/app` → urlFilter `||example.com/app`（裸 host + 路径前缀，http/https 均命中）。
 */

/** DNR 规则的最小结构描述（避免耦合具体类型包，由 background 侧适配）。 */
export interface NoCacheDnrRule {
  id: number;
  priority: number;
  action: {
    type: 'modifyHeaders';
    requestHeaders: { header: string; operation: 'set'; value: string }[];
    responseHeaders: { header: string; operation: 'set' | 'remove'; value?: string }[];
  };
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes: string[];
  };
}

/** patterns 上限（与 SettingsSchema.noCachePatterns 的 max 一致，防 DNR 动态规则配额膨胀）。 */
export const NO_CACHE_PATTERNS_LIMIT = 50;

/**
 * 请求头注入（DevTools「Disable cache」的实现方式）：
 * `no-cache` 让缓存层在查找阶段即放行，强制发网络请求（可 304 协商）；Pragma 兼容 HTTP/1.0。
 */
const NO_CACHE_REQUEST_HEADERS: NoCacheDnrRule['action']['requestHeaders'] = [
  { header: 'Cache-Control', operation: 'set', value: 'no-cache' },
  { header: 'Pragma', operation: 'set', value: 'no-cache' }
];

/** 命中规则时统一覆盖的响应头（新响应不落盘：强缓存与协商缓存的存储条目一并失效）。 */
const NO_CACHE_RESPONSE_HEADERS: NoCacheDnrRule['action']['responseHeaders'] = [
  { header: 'Cache-Control', operation: 'set', value: 'no-cache, no-store, must-revalidate' },
  { header: 'Pragma', operation: 'set', value: 'no-cache' },
  { header: 'Expires', operation: 'set', value: '0' },
  { header: 'ETag', operation: 'remove' },
  { header: 'Last-Modified', operation: 'remove' }
];

/** 覆盖全部常见请求类型：主文档与所有子资源一并禁缓存。 */
const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'media',
  'websocket',
  'other'
] as const;

/** 主机名合法字符（ASCII 域名 / punycode / IPv4 字面量；端口与 IPv6 走完整前缀形态）。 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
/** 路径部分允许的 URL 字符（排除空白、引号、反引号与 DNR 通配锚字符）。 */
const PATH_PATTERN = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/%]+$/;
/** 用户输入中禁止出现的 DNR 模式语法字符（防止无意间写成通配/锚定规则）。 */
const FORBIDDEN_CHARS = /[\s|`"'^*]/;
/** pattern 最大长度。 */
const PATTERN_MAX_LENGTH = 200;

/** regex 元字符转义（域名场景下实际只需处理 `.`，通用转义以保安全）。 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 单条 pattern 的匹配条件（纯域名用子域 regex；其余用 urlFilter）。 */
function buildCondition(
  pattern: string
): Pick<NoCacheDnrRule['condition'], 'urlFilter' | 'regexFilter'> {
  if (pattern.includes('://')) {
    return { urlFilter: pattern };
  }
  if (!pattern.includes('/')) {
    // 裸域 + 任意深度子域：`([^/?#]+\.)?` 覆盖 `www.` / `a.b.` 前缀，`([/:?#]|$)` 界定主机名边界。
    return { regexFilter: `^https?://([^/?#]+\\.)?${escapeRegex(pattern)}([/:?#]|$)` };
  }
  return { urlFilter: `||${pattern}` };
}

/**
 * 把 patterns 编译为 DNR 动态规则（全量替换式，id 与 pattern 下标一一对应，稳定可清理）。
 */
export function buildNoCacheDnrRules(patterns: string[]): NoCacheDnrRule[] {
  return patterns.map((pattern, index) => ({
    id: index + 1,
    priority: 1,
    action: {
      type: 'modifyHeaders' as const,
      requestHeaders: NO_CACHE_REQUEST_HEADERS.map((header) => ({ ...header })),
      responseHeaders: NO_CACHE_RESPONSE_HEADERS.map((header) => ({ ...header }))
    },
    condition: {
      ...buildCondition(pattern),
      resourceTypes: [...RESOURCE_TYPES]
    }
  }));
}

/**
 * 归一化并校验用户输入的 pattern。
 * @returns 规范后的 pattern；非法输入返回 null。
 */
export function normalizeNoCachePattern(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > PATTERN_MAX_LENGTH) return null;
  if (FORBIDDEN_CHARS.test(trimmed)) return null;

  // 形态 1：完整 URL 前缀（必须显式 http/https）。
  if (trimmed.includes('://')) {
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
      const url = new URL(trimmed);
      // scheme + host(含端口) 小写化（域名大小写不敏感），路径/查询保留用户原样。
      const rest = trimmed.slice(trimmed.indexOf('://') + 3).replace(/^[^/?#]*/, '');
      const normalized = `${url.protocol}//${url.host.toLowerCase()}${rest}`;
      return normalized.length <= PATTERN_MAX_LENGTH ? normalized : null;
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

/**
 * 判断 URL 是否命中 pattern（与 DNR 规则的匹配语义保持一致）。
 * 无效 URL（非 http/https）一律不命中。
 */
export function matchesNoCachePattern(url: string, pattern: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

  // 形态 1：完整前缀。
  if (pattern.includes('://')) return url.startsWith(pattern);

  const slashIndex = pattern.indexOf('/');
  // 形态 2：纯域名 → 裸域或任意深度子域。
  if (slashIndex === -1) {
    const host = parsed.hostname.toLowerCase();
    return host === pattern || host.endsWith(`.${pattern}`);
  }

  // 形态 3：域名 + 路径前缀 → host 精确相等且路径前缀匹配。
  const host = parsed.hostname.toLowerCase();
  const path = pattern.slice(slashIndex);
  return host === pattern.slice(0, slashIndex) && parsed.pathname.startsWith(path);
}
