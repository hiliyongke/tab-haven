import { defineConfig } from 'vitest/config';

/**
 * 工作区根测试配置：**只跑跨包守卫**。
 *
 * apps/extension 与 packages/i18n-kit 各自带 vitest.config.ts（随包走，include 与覆盖率
 * 阈值里的 `src/**`、`tests/**` 因此都不必改成跨目录路径）。这里刻意收窄到 `tests/**`，
 * 否则根级 vitest 会把两个包的测试一起收进来重复跑一遍。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    isolate: true,
    restoreMocks: true,
    clearMocks: true,
    environment: 'node'
  }
});
