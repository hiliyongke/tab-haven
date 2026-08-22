import { defineConfig } from 'vitest/config';

/**
 * i18n-kit 自带测试配置。
 *
 * 测试通过包名 `i18n-kit` 导入被测代码（Node 自引用：包内 package.json 有 name 与
 * exports 即可），所以迁到本包 tests/ 后导入语句一行都不用改。
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
