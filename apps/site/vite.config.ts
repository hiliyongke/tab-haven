import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const siteDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * 官网构建配置（独立于扩展的 wxt.config.ts）。
 *
 * 两条构建轨道：
 *  1. 客户端：index.html → dist/index.html + assets（只含 CSS 与约 2KB 的行为脚本，
 *     **不含 React 运行时** —— React 只出现在 SSR 轨道里）；
 *  2. SSR：src/entry-server.tsx → dist/.ssr/entry-server.js，由 build.mjs 载入后
 *     按语言预渲染两份静态 HTML。
 */
export default defineConfig({
  root: siteDir,
  // 一律绝对资源路径：/en/index.html 与 /index.html 必须命中同一份 assets。
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
    // 小 SVG 内联：品牌 logo 与装饰图形走 ?raw 内联，这里只兜住其它小资源
    assetsInlineLimit: 8192,
    // 官网只有一份入口脚本，preload 依赖解析带来的收益不足以抵消告警噪声
    modulePreload: { polyfill: false, resolveDependencies: () => [] }
  },
  server: { port: 5174, strictPort: true }
});
