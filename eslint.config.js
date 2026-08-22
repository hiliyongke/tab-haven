import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * 工作区根 ESLint：只管 `packages/**` 与根级文件。
 *
 * apps/*（扩展、官网）各自带 eslint.config.js —— 它们有自己的插件（react-hooks、
 * react-refresh）与门禁，根不该重复收编，故在此整体忽略。
 */
export default tseslint.config(
  {
    ignores: ['apps/**', 'node_modules/**', 'coverage/**', '.simple-git-hooks.cjs']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Node 侧脚本（i18n-kit CLI）：ESLint 默认按浏览器环境解析，需显式声明 Node 全局。
  // 未安装 globals 包，仅声明实际用到的几个，避免为一个脚本引入新依赖。
  {
    files: ['packages/**/bin/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly'
      }
    }
  },
  prettier
);
