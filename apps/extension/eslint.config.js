import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // 本包自带配置，`pnpm --filter tabs lint` 在 apps/extension 下执行。
    // 官网 apps/site 另有自己的配置，根的 `pnpm lint` 只管 packages/ 与根级文件。
    ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'dist/**', 'coverage/**']
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
  // Node 侧脚本（隐私回归、CRX 签名）：ESLint 默认按浏览器环境解析，
  // 需显式声明 Node 全局。未安装 globals 包，仅声明实际用到的几个，避免为一个
  // 脚本引入新依赖。
  {
    files: ['scripts/**/*.mjs'],
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
