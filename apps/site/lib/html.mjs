/**
 * HTML 片段生成（build.mjs 与 dev.mjs 共用，避免两处漂移）。
 *
 * 由 Node 直接加载：site.config.ts 走 Node 的 TS 类型剥离，无需先编译。
 */
import { BRAND, LANGUAGES, SITE_URL } from '../site.config.ts';

/** HTML 文本转义：标题与描述由人来写，但转义是默认动作，不是可选优化。 */
export function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON-LD：SoftwareApplication（免费、无账号的浏览器扩展）。 */
function jsonLd({ description, url, version }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: BRAND,
    applicationCategory: 'BrowserApplication',
    operatingSystem: 'Chrome / Edge / Brave',
    description,
    url,
    softwareVersion: version,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
  };
}

export function serializeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * 每语言一份的 `<head>` 注入片段。
 *
 * SITE_URL 为空时**不产出** canonical / hreflang / JSON-LD：把占位域名发布出去
 * 比缺这几个标签严重得多，故宁缺。
 */
export function renderHead({ lang, title, description, version }) {
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:locale" content="${escapeHtml(lang.htmlLang)}" />`,
    '<meta name="twitter:card" content="summary" />'
  ];

  if (SITE_URL) {
    const url = `${SITE_URL}${lang.path}`;
    tags.push(`<link rel="canonical" href="${escapeHtml(url)}" />`);
    for (const alt of LANGUAGES) {
      tags.push(
        `<link rel="alternate" hreflang="${escapeHtml(alt.htmlLang)}" href="${escapeHtml(
          `${SITE_URL}${alt.path}`
        )}" />`
      );
    }
    tags.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(`${SITE_URL}/`)}" />`);
    tags.push(
      `<script type="application/ld+json">${serializeJsonLd(jsonLd({ description, url, version }))}</script>`
    );
  } else {
    // 注释刻意全英文：中英文页面共用这段 head，中文注释会让英文产物残留汉字
    // （build.mjs 的自检会拦下它）。
    tags.push('<!-- canonical / hreflang / JSON-LD omitted: SITE_URL is not configured -->');
  }

  return tags.join('\n    ');
}

/** 把渲染结果套进模板：替换 lang、剥离模板自带 title、注入 head 与 #root 内容。 */
export function applyTemplate(template, { lang, head, body }) {
  return template
    .replace(/<html lang="[^"]*">/, `<html lang="${lang.htmlLang}">`)
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace('<!--SITE_HEAD-->', head)
    .replace('<!--SITE_APP-->', body);
}
