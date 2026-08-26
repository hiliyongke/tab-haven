import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// TABHAVEN_VARIANT=compat：兼容变体（剥离 sidePanel，面向不支持侧边栏的 Chromium 内核）
// 见 docs/ARCHITECTURE.md 第 5 章「已知约束」的兼容变体条目。V1.0 只发布标准版，兼容版管道建成但随 V2.0 交付。
//
// 实现说明：WXT 会自动检测 sidepanel.html 入口并合并 side_panel 字段与
// sidePanel 权限，manifest 配置函数无法可靠覆盖（实测）。因此兼容变体的
// 字段剥离放在 build:manifestGenerated hook 中做确定性后处理。
const isCompatVariant = process.env.TABHAVEN_VARIANT === 'compat';

export default defineConfig({
  // 源码目录：分层结构（core/platform/stores/ui/entrypoints）位于 src/ 下
  srcDir: 'src',
  // 显式导入，关闭 auto-imports（保持代码可读性与 ESLint 完整性）
  imports: false,
  manifest: () => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    minimum_chrome_version: '114',
    // options_ui 由 WXT 检测 options 入口自动生成（含 page），此处仅覆盖 open_in_tab
    options_ui: { open_in_tab: true },
    permissions: [
      'tabs',
      'tabGroups',
      'storage',
      'alarms',
      'contextMenus',
      'omnibox',
      'sessions',
      'bookmarks',
      'notifications',
      // 开发者禁缓存能力：DNR 改响应头 + 动态注入提示条。
      // host 权限刻意走 optional（按需请求）：不开该功能则安装时不出现全站权限警告。
      'declarativeNetRequest',
      'scripting'
    ],
    optional_host_permissions: ['<all_urls>'],
    commands: {
      'focus-search': {
        suggested_key: { default: 'Ctrl+Shift+F' },
        description: '__MSG_commandFocusSearch__'
      },
      'open-panel': {
        suggested_key: { default: 'Ctrl+Shift+O' },
        description: '__MSG_commandOpenPanel__'
      },
      'locate-active': {
        suggested_key: { default: 'Ctrl+Shift+L' },
        description: '__MSG_commandLocateActive__'
      },
      'discard-inactive': {
        suggested_key: { default: 'Ctrl+Shift+U' },
        description: '__MSG_commandDiscardInactive__'
      }
    }
    // side_panel 字段与 sidePanel 权限由 WXT 检测 sidepanel 入口自动生成；
    // action 由 WXT 检测 popup 入口自动生成。标准版点击 action 打开侧边栏
    // 由 background 的 setPanelBehavior({ openPanelOnActionClick }) 控制，
    // default_popup 仅在右键图标时作为快速切换器入口（Chrome 平台行为）。
  }),
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      // options_ui 由 WXT 检测 options 入口自动生成，其 open_in_tab 默认值（false）
      // 无法被 manifest() 配置可靠覆盖（实测），故在此确定性后处理。
      if (manifest.options_ui) manifest.options_ui.open_in_tab = true;

      if (!isCompatVariant) {
        // 标准版（侧边栏形态）：点击图标开侧边栏，绝不可绑定 default_popup，
        // 否则 Chrome 优先打开 popup 而非 sidePanel（实测：openPanelOnActionClick
        // 与 default_popup 共存时 popup 胜出）。快速切换器仅在兼容变体启用。
        if (manifest.action) delete manifest.action.default_popup;
        return;
      }

      // 兼容变体：<114 内核遇未知权限字符串会加载失败，必须剥离 sidePanel。
      delete manifest.side_panel;
      if (manifest.permissions) {
        manifest.permissions = manifest.permissions.filter(
          (permission) => permission !== 'sidePanel'
        );
      }
      // 降级形态：action 绑定 popup 快速切换器。
      if (manifest.action) {
        manifest.action.default_popup = 'popup.html';
      }
    }
  },
  vite: () => ({
    // 固定 dev server 端口并启用 strictPort：避免 Vite 在 3000 被占用时自增到 3001，
    // 否则 HTML 引用的脚本源（localhost:3000）与 WXT 自动生成进 manifest 的 CSP
    // （允许 localhost:3001）不一致，导致 sidepanel 脚本被内容安全策略拦截。
    server: { port: 3000, strictPort: true },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  })
});
