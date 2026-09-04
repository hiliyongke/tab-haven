import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

/**
 * 测试配置。
 *
 * 环境选择仍走文件顶部的 `// @vitest-environment jsdom` 注释：Vitest 4 已移除
 * `environmentMatchGlobs`，集中声明只能用 `projects`（为一个扩展项目引入多套
 * 配置，收益不抵复杂度）。注释方案版本无关且就近自解释，保留。
 */
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
    // 隔离默认值在旧版本曾为 false，显式声明以保证每个测试文件独立环境。
    isolate: true,
    // 每个文件结束后自动还原/清理 mock：此前各文件自行调用 restoreMocks，
    // 漏写即造成跨用例的 spy 泄漏（表现为「单独跑通过、全量跑失败」）。
    restoreMocks: true,
    clearMocks: true,
    setupFiles: ['tests/setup.ts'],
    // core 纯函数测试默认 node 环境；UI/平台层测试在文件顶部以
    // `// @vitest-environment jsdom` 注释按需切换。
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        // 入口壳与 i18n 资源由构建/脚本覆盖，不进阈值统计。
        'src/entrypoints/**/main.tsx',
        'src/i18n/locales/**',
        'src/theme-init.ts'
      ],
      /**
       * 阈值按目录分层，取「当前实测值 − 余量」作为棘轮基线：
       * 目的是锁住既有覆盖不回退，再逐迭代收紧，而不是一次性设成理想值然后长期飘红。
       *
       *   - `src/core/**`：纯领域逻辑，是唯一要求接近满覆盖的层（实测 ~95%）；
       *   - `src/platform/**`：chrome 适配层，实测 ~70%，三座孤岛补测后仍有缺口；
       *   - 全局：被 `ui/` 与 `entrypoints/`（实测 0–15%）拉低，先给宽松基线。
       *
       * 收紧顺序建议：先 entrypoints（主控制器）→ ui → platform，再抬全局。
       */
      thresholds: {
        global: { lines: 42, statements: 40, branches: 35, functions: 33 },
        'src/core/**': { lines: 88, statements: 88, branches: 72, functions: 85 },
        'src/platform/**': { lines: 60, statements: 60, branches: 55, functions: 55 }
      }
    }
  }
});
