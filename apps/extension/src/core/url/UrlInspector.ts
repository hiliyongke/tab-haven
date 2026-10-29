/**
 * URL 检视：把标签页 URL 规约为统一检视结果（先规约 normalize、后分类 classify）。
 * 本模块是整个产品 URL 判定的唯一事实来源（复用引擎、聚合、清理共用）。
 */

type UrlCategory = 'web' | 'blank-start' | 'internal';

interface UrlInspection {
  /** web = 可参与复用/聚合的 http(s) 页；blank-start = 空白起始页等待导航；internal = 浏览器内部页。 */
  category: UrlCategory;
  /** 同 URL 比较键：导航中取 pendingUrl，否则取已提交 URL。 */
  comparisonKey: string;
  committedUrl: string;
}

/**
 * http(s) 绝对 URL 的严格前缀判定（全仓唯一实现），用于外部输入白名单（导入备份、地址栏直开）：
 * `https:example.com` 这类不带 `//` 的写法不该放行去 `tabs.create`。
 * 与 `isWebUrl`（解析后协议判定，输入形态由浏览器保证）分工不同，不要互相替换。
 */
const HTTP_SCHEME_PREFIX = /^https?:\/\//i;

export function isHttpUrl(url: string | undefined): url is string {
  return url !== undefined && HTTP_SCHEME_PREFIX.test(url);
}

const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/** 空白起始页（规范形：无尾斜杠、无 hash 片段）。 */
const BLANK_START_URLS = new Set(['about:blank', 'chrome://newtab', 'chrome://new-tab-page']);

/** 空白起始页判定：容忍尾斜杠/hash 变体（如 chrome://newtab、about:blank#blocked）。 */
function isBlankStartUrl(raw: string): boolean {
  if (raw === '') return true;
  const canonical = raw.split('#')[0]!.replace(/\/$/, '').toLowerCase();
  return BLANK_START_URLS.has(canonical);
}

function isWebUrl(raw: string): boolean {
  try {
    return WEB_PROTOCOLS.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/** 各协议的默认端口（显式写出时与省略等价）。 */
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * 归约为比较键：只动 authority（主机名小写 + 剥离默认端口），其余原样保留。
 * 必须归一：比较键来源含用户手输（omnibox `pin:`）与导入备份，可能是 `HTTPS://A.COM/P`，不归一会让重复标签检测静默漏判。
 * 只动 authority 是因为路径 / 查询 / 片段参与页面身份（`/a` 与 `/a/` 可能是不同资源），刻意保留。
 */
function toComparisonKey(raw: string): string {
  try {
    const url = new URL(raw);
    const defaultPort = DEFAULT_PORTS[url.protocol];
    const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}${url.pathname}${url.search}${url.hash}`;
  } catch {
    // 无法解析时原样返回：此处只在 isWebUrl 已通过后被调用，属兜底。
    return raw;
  }
}

/** 提取 URL 的主机名；无 URL / 无法解析 / 空主机时返回 `undefined`（不用空串，避免凭空多出「空站点」且 `if (host)` 无法区分）。 */
export function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 检视一个标签的 URL 并按优先级分类：pending 为 web 页则 web（比较键取 pending）；
 * 否则按已提交 URL 判定 blank-start / web / internal。
 */
export function inspectUrl(
  committedUrl: string | undefined,
  pendingUrl: string | undefined
): UrlInspection {
  const committed = committedUrl ?? '';
  const pending = pendingUrl ?? '';

  if (pending && isWebUrl(pending)) {
    return { category: 'web', comparisonKey: toComparisonKey(pending), committedUrl: committed };
  }

  if (isBlankStartUrl(committed)) {
    return {
      category: 'blank-start',
      comparisonKey: pending || committed,
      committedUrl: committed
    };
  }

  if (isWebUrl(committed)) {
    return {
      category: 'web',
      comparisonKey: toComparisonKey(committed),
      committedUrl: committed
    };
  }

  return { category: 'internal', comparisonKey: pending || committed, committedUrl: committed };
}

/** 快捷判定：返回可参与复用/聚合的网页比较键；非 web 页（内部页/空白起始页）返回 null，供调用方跳过。 */
export function webComparisonKey(
  committedUrl: string | undefined,
  pendingUrl: string | undefined
): string | null {
  const inspection = inspectUrl(committedUrl, pendingUrl);
  return inspection.category === 'web' && inspection.comparisonKey
    ? inspection.comparisonKey
    : null;
}
