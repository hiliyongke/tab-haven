import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
