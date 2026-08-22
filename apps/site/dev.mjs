/**
 * 官网开发预览：Vite middlewareMode + SSR 即时渲染（改源码即刷新，HMR 可用）。
 *
 * 端口固定 5174：扩展的 `pnpm dev` 占用 3000（wxt.config.ts 里 strictPort），
 * 两者可以同时开着。
 */
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { applyTemplate, renderHead } from './lib/html.mjs';
import { LANGUAGES } from './site.config.ts';

const siteDir = fileURLToPath(new URL('.', import.meta.url));
const templatePath = join(siteDir, 'index.html');
// 与 build.mjs 同源：版本号取自扩展包（工作区根 package.json 是纯编排，没有版本号）
const version = String(
  JSON.parse(readFileSync(resolve(siteDir, '../..', 'apps', 'extension', 'package.json'), 'utf8'))
    .version
);
// 与 build.mjs 同源：年份构建期注入，不写死
const year = String(new Date().getFullYear());

const vite = await createViteServer({
  configFile: join(siteDir, 'vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom'
});

const server = createHttpServer((req, res) => {
  // 归一化尾斜杠：/en 与 /en/ 是同一个页面，不归一化会掉进 vite.middlewares
  // 拿到中文首页（或 404）。
  const raw = (req.url ?? '/').split('?')[0];
  const url = raw.endsWith('/') ? raw : `${raw}/`;
  const lang = LANGUAGES.find((item) => item.path === url);

  if (!lang) {
    vite.middlewares(req, res);
    return;
  }

  void (async () => {
    // 必须兜住：渲染抛错若变成 unhandled rejection，整个 dev 进程会直接退出，
    // 且这个请求永远等不到 res.end()（浏览器一直转圈，看不到任何报错）。
    try {
      const { render } = await vite.ssrLoadModule('/src/entry-server.tsx');
      const result = render(lang.code, { version, year });
      const template = await vite.transformIndexHtml(url, readFileSync(templatePath, 'utf8'));
      const html = applyTemplate(template, {
        lang,
        head: renderHead({
          lang,
          title: result.title,
          description: result.description,
          version
        }),
        body: result.html
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    } catch (error) {
      console.error(`[site] 渲染 ${url} 失败：`, error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`SSR error: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('[site] 5174 端口被占用：先停掉已有的 dev server，或改 vite.config.ts 的 port');
  }
  console.error(error);
  process.exitCode = 1;
});

server.listen(5174);
console.log('[site] dev → http://localhost:5174/ （英文 http://localhost:5174/en/）');
