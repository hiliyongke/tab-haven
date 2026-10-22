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
    // 显式声明以保证每个测试文件独立环境。
    isolate: true,
    // 每个文件结束后自动还原/清理 mock：交给配置统一兜底，各文件自行调用容易漏写，
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
        'src/i18n/locales/**',
        /**
         * 入口壳（各入口目录下的 main.tsx）只有 `createRoot().render()` —— 无分支、
         * 无逻辑，把它计入覆盖率只会稀释均值，且测它等于测 React 本身。
         *
         * 这条排除的**判据**是「main.tsx 里不允许有逻辑」（分层红线：entrypoints
         * 只组装）：`theme-init.ts` 与曾经的 `OptionsRoot`/`AboutRoot` 都曾挂在入口
         * 壳里，前者已单独纳入统计（`tests/config/theme-init.test.ts`），后者已下沉
         * 为 `ui/common/EntryRoot` 并纳入 `src/ui/common/**` 阈值。往 main.tsx 里
         * 写逻辑会让这段代码自动脱离门禁 —— 这是本排除项唯一的失效方式。
         */
        'src/entrypoints/**/main.tsx'
      ],
      /**
       * 阈值按目录分层，取「当前实测值 − 约 8 点余量」作为棘轮基线：
       * 目的是锁住既有覆盖不回退，再逐迭代收紧，而不是一次性设成理想值然后长期飘红。
       *
       *   - `src/core/**`：纯领域逻辑，是唯一要求接近满覆盖的层；
       *   - `src/platform/*.ts`：平台层**直连文件**（tabs / messages / diagnostics /
       *     bookmarks / sessions / permissions / navigation / registry / sidePanel）。
       *     为什么要单列这一组：目录均值会**稀释**个别文件的缺口。若这些文件只受
       *     `src/platform/**` 约束，而该组是「直连文件 + 子目录」的整体均值，
       *     单个直连文件即便远低于阈值也会被子目录抬高的均值掩盖。
       *   - `src/entrypoints/background.ts` 与 `src/platform/background/**`：
       *     SW 编排层（入口 + 子模块），是「出问题用户看不见」的能力
       *     （重复标签复用 / 关窗自动快照 / 自动休眠 / 右键菜单 / 地址栏命令）的所在地。
       *     子模块目录**不在 entrypoints 下**：曾写作 `src/entrypoints/background/**`，
       *     而该目录不存在（入口是单文件 background.ts）——glob 命中 0 个文件，
       *     阈值恒绿，等于这条门禁从未生效。
       *   - `src/platform/**`：平台层整体（直连文件 + 子目录）。
       *   - 全局：被 `ui/` 与 `stores/` 拉低，先给宽松基线。
       *
       * 注：阈值 glob 之间是**相互独立**的，各自匹配各自的文件集合并单独判定 ——
       * `src/platform/**` 与 `src/platform/*.ts` 会同时生效，前者覆盖后者。
       * 判定某条 glob 命中哪些文件、实测值是多少：跑一次
       * `vitest run --coverage --coverage.reporter=json-summary`，
       * 再按 glob 汇总 `coverage-summary.json`（同一轮里两条 glob 的数字不能直接对比）。
       *
       * 收紧顺序建议：entrypoints → ui 组件 → stores/data → 再抬全局。
       */
      thresholds: {
        // 全局实测 lines 76.4 / stmts 74.9 / branch 66.4 / funcs 69.9
        global: { lines: 68, statements: 67, branches: 58, functions: 62 },
        // 实测 lines 97.1 / stmts 94.4 / branch 86.1 / funcs 98.3
        'src/core/**': { lines: 90, statements: 87, branches: 79, functions: 91 },
        // 直连文件实测 lines 91.0 / stmts 89.5 / branch 83.9 / funcs 88.2
        'src/platform/*.ts': { lines: 88, statements: 86, branches: 80, functions: 85 },
        // SW 入口实测 lines 77.6 / stmts 75.5 / branch 64.6 / funcs 70.5
        'src/entrypoints/background.ts': { lines: 72, statements: 70, branches: 58, functions: 65 },
        // SW 子模块实测 lines 90.0 / stmts 88.9 / branch 85.5 / funcs 80.7
        'src/platform/background/**': { lines: 82, statements: 81, branches: 78, functions: 73 },
        // 固定空间实测 lines 92.0 / stmts 92.3 / branch 72.5 / funcs 84.4
        'src/ui/fixed/**': { lines: 84, statements: 84, branches: 70, functions: 78 },
        // 拖拽层实测 lines 89.9 / stmts 88.2 / branch 83.9 / funcs 81.3
        'src/ui/dnd/**': { lines: 82, statements: 80, branches: 76, functions: 73 },
        // 通用组件层实测 lines 74.1 / stmts 72.9 / branch 64.2 / funcs 71.2
        'src/ui/common/**': { lines: 66, statements: 65, branches: 56, functions: 63 },
        // store 层：直连文件实测 lines 68.1 / stmts 66.4 / branch 65.7 / funcs 68.5
        'src/stores/*.ts': { lines: 63, statements: 61, branches: 64, functions: 64 },
        // 切片目录实测 lines 80.8 / stmts 78.1 / branch 70.8 / funcs 77.4
        // （types.ts 是纯类型文件、恒 0%，会把均值压低，阈值按均值给）
        'src/stores/data/**': { lines: 73, statements: 70, branches: 63, functions: 70 },
        // 平台层整体实测 lines 89.4 / stmts 87.6 / branch 82.1 / funcs 84.8
        'src/platform/**': { lines: 81, statements: 79, branches: 74, functions: 77 }
      }
    }
  }
});
