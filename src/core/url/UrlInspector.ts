/**
 * URL 检视：把标签页的 URL 输入规约为统一的检视结果。
 *
 * 单一入口，职责分离为两步（内部实现）：
 *  1. 规约（normalize）：解析 URL、判定协议、归一化 hostname；
 *  2. 分类（classify）：按业务语义给出类别。
 *
 * 本模块是整个产品 URL 判定的唯一事实来源（复用引擎、聚合、清理共用）。
 */

export type UrlCategory = 'web' | 'blank-start' | 'internal';

export interface UrlInspection {
  /** web = 可参与复用/聚合的 http(s) 页；blank-start = 空白起始页等待导航；internal = 浏览器内部页。 */
  category: UrlCategory;
  /** 同 URL 比较键：导航中取 pendingUrl，否则取已提交 URL。 */
  comparisonKey: string;
  /** 已提交 URL（可能为空串）。 */
  committedUrl: string;
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
 *
 * 为什么必须归一：比较键是重复判定、复用引擎、固定空间去重的唯一口径，
 * 而这些 URL 有三个来源——浏览器 API（已是规范形）、**用户手输**（omnibox `pin:`）、
 * **导入的备份文件**。后两者完全可能出现 `HTTPS://A.COM/P` 这类写法，
 * 不归一的结果是「明明是同一个页面却判成两个」，即重复标签检测静默漏判。
 *
 * 为什么只动 authority：路径 / 查询 / 片段参与页面身份——`/a` 与 `/a/`
 * 在部分站点确为不同资源，剥离查询参数更会把带追踪参数的链接与裸链接混为一谈。
 * 这两类刻意保留（等价类矩阵见 `tests/core/url/url-normalize.test.ts`）。
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

/**
 * 检视一个标签的 URL。判定优先级：
 *  1. 导航中（pending 存在且为 web 页）→ web，比较键取 pending；
 *  2. 已提交为空白起始页 → blank-start（等待真实导航）；
 *  3. 已提交为 web 页 → web；
 *  4. 其余（内部页/无法解析）→ internal。
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

/**
 * 快捷判定：返回可参与复用/聚合的网页比较键。
 * 非 web 页（内部页/空白起始页）返回 null，供调用方直接跳过。
 * 复用引擎、重复清理、固定空间共用此单一判定。
 */
export function webComparisonKey(
  committedUrl: string | undefined,
  pendingUrl: string | undefined
): string | null {
  const inspection = inspectUrl(committedUrl, pendingUrl);
  return inspection.category === 'web' && inspection.comparisonKey
    ? inspection.comparisonKey
    : null;
}
