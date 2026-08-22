import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

/**
 * 官网独立 lint 配置（根 eslint 的 ignores 已排除 site/）。
 *
 * 与根配置同源同强度（js.recommended + ts.recommended + react-hooks + prettier），
 * 不是放宽门禁：官网只是构建期渲染 React，hooks 规则对 src/ 下的组件同样适用。
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'src/i18n/locales/**', '.vite/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  // 构建脚本（dev.mjs / build.mjs）：ESLint 默认按浏览器环境解析，需显式声明 Node 全局。
  {
    files: ['*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly'
      }
    }
  },
  prettier
);
