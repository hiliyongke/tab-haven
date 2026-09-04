/**
 * 指定站点 / URL 前缀禁用前端缓存。纯逻辑层，无浏览器 API 依赖。
 *
 * 禁缓存需同时改请求头与响应头：只改响应头时，已缓存资源不产生网络请求，规则不会触发。
 * 请求头 no-cache 让缓存层在查找阶段即放行；响应头 no-store + 移除
 * ETag/Last-Modified 使协商标识失效，下次请求直接完整拉取。
 *
 * pattern 三类形态，与 DNR 匹配语义保持一致：
 *  1. 完整前缀 `https://example.com/app` → urlFilter 原样；
 *  2. 纯域名 `example.com` → regexFilter，匹配裸域与任意深度子域；
 *  3. 域名+路径 `example.com/app` → urlFilter `||example.com/app`。
 *
 * pattern 的归一化与校验不在此处：见 `@/core/nocache/noCachePattern`，由
 * SettingsSchema 在写入前统一完成，本模块只消费已归一的 pattern。
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
