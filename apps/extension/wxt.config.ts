import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * dev server 端口：`vite().server` 与下面 dev 态 CSP 共用同一份（strictPort）。
 * dev 模式需放行本地开发源；WXT 会为 `script-src` 加入 dev origin，style / img / connect
 * 指令也需显式允许开发源。
 */
const DEV_SERVER_PORT = 3000;
const DEV_ORIGIN = `http://localhost:${DEV_SERVER_PORT}`;
const DEV_WS_ORIGIN = `ws://localhost:${DEV_SERVER_PORT}`;

/**
 * 扩展页 CSP：sidepanel / options / about / 卸载备份页，以及后台 Service Worker
 * 都由 `content_security_policy.extension_pages` 管。
 *
 * MV3 默认 CSP 只锁定 `script-src 'self'; object-src 'self'`，其他资源指令由此处明确设置。
 * 生产构建将 `connect-src` 设为 `'none'`，其余扩展页资源仅允许产品实际使用的来源。
 *
 * 逐条用途与放开原因（动任何一条都会影响全部扩展页）：
 * - `default-src 'self'`：兜底。未单列的指令（worker-src / media-src / frame-src 等）
 *   一律只认扩展自身来源。
 * - `script-src 'self'`：MV3 硬要求（只允许扩展本地脚本）。dev 下 WXT 自动追加 dev
 *   server origin，此处无需处理。
 * - `object-src 'self'`：同上，MV3 硬要求。
 * - `style-src 'self' 'unsafe-inline'`：**'unsafe-inline' 不能省** ——
 *   ① `public/uninstall-backup.html` 的样式是整段内联 `<style>`（该页不得引外部
 *   资源）；② React 的 `style={{ }}` 属性属 style-src-attr，同样归这条管。
 *   不放开这两处会直接掉样式 / 掉行内尺寸。
 * - `img-src 'self' data: chrome-extension:`：站点图标走浏览器自己的 favicon 通道
 *   `chrome-extension://<id>/_favicon/`（见 `platform/favicon.ts`），必须放行
 *   chrome-extension: 否则图标全灭（会静默回退成首字母方块，不易察觉）；
 *   data: 留给内联占位图（当前代码未使用，去掉不影响现状，保留以免将来内联
 *   SVG / 占位图被静默拦截）。
 * - `font-src 'self'`：项目无 @font-face、全用系统字体，这里只是把默认敞开收掉。
 * - `connect-src 'none'`：产品宪法是零出站 —— fetch / XHR / WebSocket / sendBeacon
 *   一律封死。**dev 必须放行 dev server**：Vite HMR 与 WXT 的页面重载都走
 *   `ws://localhost:3000`，封掉即热重载失效（功能不受影响，但开发体验归零）。
 * - `form-action 'none'` / `base-uri 'none'`：扩展页不提交表单、不写 `<base>`，
 *   顺手堵掉这两条注入面。
 *
 * ⚠️ CSP 写错的表现是**整个扩展白屏**（脚本 / 样式被拦），且只在真正加载扩展时
 * 才暴露，typecheck 与单测都发现不了。改这里之后必须：
 *   1. `pnpm build`；
 *   2. 加载 `.output/chrome-mv3`（chrome://extensions 开发者模式）；
 *   3. 手动冒烟：侧边栏能开、站点图标能显示、主题切换正常、DevTools Console
 *      无 CSP 违规报错；
 *   4. 再分别打开设置页、关于页与
 *      `chrome-extension://<id>/uninstall-backup.html`，确认内联样式生效；
 *   5. 另跑一次 `pnpm dev`，确认 HMR 仍生效（dev 态走上面那条放行分支）。
 */
function extensionPagesCsp(isDev: boolean): string {
  // dev 下需要放行 dev server 的指令统一追加（script-src 由 WXT 自己补）。
  const devOrigin = isDev ? ` ${DEV_ORIGIN}` : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "object-src 'self'",
    `style-src 'self' 'unsafe-inline'${devOrigin}`,
    `img-src 'self' data: chrome-extension:${devOrigin}`,
    `font-src 'self'${devOrigin}`,
    isDev ? `connect-src 'self' ${DEV_ORIGIN} ${DEV_WS_ORIGIN}` : "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ');
}

export default defineConfig({
  // 源码目录：分层结构（core/platform/stores/ui/entrypoints）位于 src/ 下
  srcDir: 'src',
  // 显式导入，关闭 auto-imports（保持代码可读性与 ESLint 完整性）
  imports: false,
  // command 由 WXT 传入（'serve' = dev / 'build' = 生产），CSP 的 dev 放行分支靠它。
  manifest: ({ command }) => ({
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
      // 这里显式列出，使权限声明与 PRIVACY.md 中的用途说明保持一致
      // （WXT 会去重，产物 manifest 中不会出现重复项）。
      'sidePanel',
      // 开发者禁缓存能力：DNR 改响应头（横幅改由侧边栏角标呈现，不注入页面）。
      // host 权限刻意走 optional（按需请求）：不开该功能则安装时不出现全站权限警告。
      'declarativeNetRequest',
      // 站点图标走浏览器自己的 favicon 通道（`chrome-extension://<id>/_favicon/`）。
      // 直接渲染站点图标地址（tab.favIconUrl）会引入第三方出站请求，且在鉴权站点上
      // 会被 302 带到登录页再跳回来（一次约 25 跳）。走本地通道后「零出站网络请求」
      // 不再有任何例外；代价是权限清单多一项（见 PRIVACY.md §2）。
      'favicon'
    ],
    optional_host_permissions: ['<all_urls>'],
    // 显式 CSP（逐条理由见上面 extensionPagesCsp 的注释）：MV3 默认只锁
    // script-src / object-src，这里把 img / font / style / connect 一并收紧，
    // 作为「零出站网络请求」的运行时兜底。生产态 connect-src 为 'none'；
    // dev 态放行 dev server 以保住 HMR（WXT 只在 dev 时改写 extension_pages，
    // 生产构建原样输出本字符串）。
    content_security_policy: {
      extension_pages: extensionPagesCsp(command === 'serve')
    },
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
    // action 字段必须显式声明：它是工具栏图标与角标
    // （`browser.action.setBadgeText`）的载体，
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
    // 端口与 DEV_SERVER_PORT 同源：dev 态 CSP 也按它放行。
    server: { port: DEV_SERVER_PORT, strictPort: true },
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
      // 目标锁定 Chrome 114（与 manifest.minimum_chrome_version 同口径）：不做多余的
      // 语法降级与 polyfill，产物更紧凑，SW 冷启动的解析开销也更低。
      target: 'chrome114',
      // 体积报告要逐 chunk 跑一遍 gzip，是构建期纯开销；体积另有 check 阶段把关。
      reportCompressedSize: false,
      // 压缩器沿用 Vite 8 默认（Rolldown + oxc），不显式指定：本项目构建链是
      // Vite 8 / Rolldown，指定 esbuild 会触发已废弃的 transformWithEsbuild 路径并报错。
      // 默认阈值 500 会让本项目每次构建都刷告警；按实际量级设定，保留真正的异常告警。
      chunkSizeWarningLimit: 600,
      // 4KB 以下资源内联：扩展内文件更少，省掉加载往返。
      assetsInlineLimit: 4096,
      // 不产出 sourcemap：扩展产物不便于外部取用，且会显著增大上架包。
      sourcemap: false,
      modulePreload: {
        polyfill: false,
        resolveDependencies: () => []
      }
    }
    // 注意：不要启用任何 drop-console / 移除 console 的压缩选项 ——
    // 诊断日志（logDegraded）依赖 console，清掉会让「导出诊断信息」导出空报告。
  })
});
