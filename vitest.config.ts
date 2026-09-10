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
       *   - `src/core/**`：纯领域逻辑，是唯一要求接近满覆盖的层（实测 100%）；
       *   - `src/platform/*.ts`：平台层**直连文件**（tabs / messages / diagnostics /
       *     bookmarks / sessions / permissions / navigation / registry / sidePanel）。
       *     为什么要单列这一组：目录均值会**稀释**个别文件的缺口。这些文件此前只被
       *     `src/platform/**` 这一条约束，而该组是「直连文件 + 子目录」的整体均值 ——
       *     bookmarks / sessions / permissions / navigation 曾实测 0%、tabs（589 行）47%，
       *     被子目录把均值抬到 70%，于是它们远低于 60 的阈值却仍然通过。
       *   - `src/entrypoints/background.ts` 与 `src/entrypoints/background/**`：
       *     SW 编排层（入口 + 9 个子模块）。曾整体 0%，是「出问题用户看不见」的能力
       *     （重复标签复用 / 关窗自动快照 / 自动休眠 / 右键菜单 / 地址栏命令）的所在地。
       *   - `src/platform/**`：平台层整体（直连文件 + 子目录），实测 ~95%。
       *   - 全局：被 `ui/`（实测 16–55%）与 `stores/` 拉低，先给宽松基线。
       *
       * 注：阈值 glob 之间是**相互独立**的，各自匹配各自的文件集合并单独判定 ——
       * `src/platform/**` 与 `src/platform/*.ts` 会同时生效，前者覆盖后者。
       * 但要判定某条 glob 到底命中了哪些文件，**只能把该条单独设为不可达阈值再跑一次**看它报的数，
       * 不能拿同一轮里两条 glob 的数字对比下结论。
       *
       * 收紧顺序建议：entrypoints → ui 组件 → stores/data → 再抬全局。
       */
      thresholds: {
        global: { lines: 63, statements: 58, branches: 50, functions: 54 },
        'src/core/**': { lines: 88, statements: 88, branches: 72, functions: 85 },
        // 直连文件实测（2026-09-10 补 messages / sessions / bookmarks / navigation /
        // permissions / diagnostics / tabs 适配器测试后）：lines 93.3 / stmts 91.4 / branch 84.1 / funcs 92.7
        'src/platform/*.ts': { lines: 86, statements: 84, branches: 76, functions: 85 },
        // SW 入口实测 lines 80.7 / stmts 75.8 / branch 64.0 / funcs 66.7
        'src/entrypoints/background.ts': { lines: 72, statements: 68, branches: 56, functions: 60 },
        // SW 子模块整体实测 lines 93.3 / stmts 91.5 / branch 78.8 / funcs 78.8
        'src/entrypoints/background/**': { lines: 86, statements: 84, branches: 72, functions: 72 },
        // 弹窗降级形态实测 lines 88.5 / stmts 84.4 / branch 73.1 / funcs 85（此前 0%）
        'src/entrypoints/popup/**': { lines: 80, statements: 76, branches: 64, functions: 76 },
        // 固定空间实测 lines 87.6 / stmts 71.3 / branch 80.5 / funcs 87.6（此前 16.1%）
        'src/ui/fixed/**': { lines: 78, statements: 62, branches: 70, functions: 78 },
        // 拖拽层实测 lines 70.9 / stmts 57.9 / branch 58.8 / funcs 58.8（此前 20.3%）
        'src/ui/dnd/**': { lines: 62, statements: 48, branches: 48, functions: 50 },
        // 通用组件层实测 lines 64.7 / stmts 63.4 / branch 62.3 / funcs 65.4（此前 53.9%）
        'src/ui/common/**': { lines: 56, statements: 55, branches: 54, functions: 57 },
        // store 层：直连文件（tabStore 已 100%）实测 70.8 / 69.7 / 73.7 / 72.4
        'src/stores/*.ts': { lines: 62, statements: 60, branches: 64, functions: 63 },
        // 切片目录实测 lines 74.6 / stmts 63.7 / branch 76.7 / funcs 77
        // （types.ts 是纯类型文件、恒 0%，会把均值压低，阈值按均值给）
        'src/stores/data/**': { lines: 66, statements: 54, branches: 56, functions: 68 },
        'src/platform/**': { lines: 60, statements: 60, branches: 55, functions: 55 }
      }
    }
  }
});
