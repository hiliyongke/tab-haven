import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
    omnibox: { keyword: 't' },
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
      // 侧边栏主形态所需。WXT 检测到 sidepanel 入口后本就会自动注入该权限，
      // 这里显式列出是让「声明」与 PRIVACY.md/隐私门禁的口径落在同一处源码上
      // （WXT 会去重，产物 manifest 中不会出现重复项）。
      'sidePanel',
      // 开发者禁缓存能力：DNR 改响应头（横幅改由侧边栏角标呈现，不注入页面）。
      // host 权限刻意走 optional（按需请求）：不开该功能则安装时不出现全站权限警告。
      'declarativeNetRequest',
      // 站点图标走浏览器自己的 favicon 通道（`chrome-extension://<id>/_favicon/`）。
      // 此前直接渲染站点图标地址（tab.favIconUrl），那是本产品唯一的第三方出站请求，
      // 且在鉴权站点上会被 302 带到登录页再跳回来（一次约 25 跳）。换成本地通道后
      // 「零出站网络请求」不再有任何例外；代价是权限清单多一项（见 PRIVACY.md §2）。
      'favicon'
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
    },
    // side_panel 字段与 sidePanel 权限由 WXT 检测 sidepanel 入口自动生成。
    // action 字段必须显式声明：此前它靠 `src/entrypoints/popup/` 这个入口「顺带」
    // 生成，而该入口的产物 default_popup 又被下方 hook 删除 —— 等于留了一份不可达
    // 的弹窗代码只为换一个 manifest 字段。现在直接声明 action，popup 入口即删除。
    // 注意：action 是工具栏图标与角标（`browser.action.setBadgeText`）的载体，
    // 缺了它扩展在工具栏上不可见、角标 API 也会失效。
    action: {
      default_title: '__MSG_extName__',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png'
      }
    }
  }),
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      // options_ui 由 WXT 检测 options 入口自动生成，其 open_in_tab 默认值（false）
      // 无法被 manifest() 配置可靠覆盖（实测），故在此确定性后处理。
      if (manifest.options_ui) manifest.options_ui.open_in_tab = true;

      // 侧边栏形态：点击图标开侧边栏，绝不可绑定 default_popup，否则 Chrome
      // 优先打开 popup 而非 sidePanel（实测：openPanelOnActionClick 与
      // default_popup 共存时 popup 胜出）。
      if (manifest.action) delete manifest.action.default_popup;
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
    },
    // 收紧 modulepreload：默认 Vite 会把入口的整张依赖图作为
    // `<link rel="modulepreload">` 注入 HTML，跨 entry 共享 chunk（splitChunks）
    // 也会被加入未真正同步依赖它们的 entry，Chrome 会在
    // 「<link rel=modulepreload> 预加载的 chunk 在数秒内未使用」上报警。
    // 这里返回空数组让 Vite 不生成 modulepreload 链接 —— 启动期
    // 会因此多出几十到一百多毫秒的按需下载（副作用），对扩展 UI 可接受，
    // 换取的代价是消除全部 3 条 preload 警告与潜在的渲染阻塞。
    build: {
      modulePreload: {
        polyfill: false,
        resolveDependencies: () => []
      }
    }
  })
});
