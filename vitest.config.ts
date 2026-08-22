import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // WXT 官方测试插件：自动把 `wxt/browser` 别名到 fake-browser，
  // 并 stub 全局 `chrome` / `browser`，使平台层（tabs/tabGroups/events）可在单测中驱动。
  plugins: [WxtVitest()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // core 纯函数测试默认 node 环境；UI/平台层测试在文件顶部以
    // `// @vitest-environment jsdom` 注释按需切换。
    environment: 'node'
  }
});
