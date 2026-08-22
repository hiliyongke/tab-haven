import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';
import { I18nContext, createSiteI18n } from './i18n';
import { siteMeta } from './content/meta';

/**
 * 构建期渲染入口：由 build.mjs（预渲染）与 dev.mjs（开发预览）共同调用。
 *
 * 走 `renderToStaticMarkup` 而不是 `renderToString`：产物是纯静态 HTML，
 * 客户端不会 hydrate，React 的 data-reactroot 标记与事件委托都是白开销。
 */
export interface RenderContext {
  /** 扩展版本号：由构建脚本从根 package.json 读取，避免两处写死 */
  version: string;
  /** 页脚版权年份：构建期注入，避免每年过期一次 */
  year: string;
}

export interface RenderResult {
  /** #root 内的 HTML */
  html: string;
  title: string;
  description: string;
}

export function render(lng: string, ctx: RenderContext): RenderResult {
  const siteI18n = createSiteI18n(lng);
  const meta = siteMeta(siteI18n.t);
  return {
    html: renderToStaticMarkup(
      <I18nContext.Provider value={siteI18n}>
        <App version={ctx.version} year={ctx.year} lng={lng} />
      </I18nContext.Provider>
    ),
    ...meta
  };
}
