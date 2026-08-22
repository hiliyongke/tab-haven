import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// TABHAVEN_VARIANT=compat：兼容变体（剥离 sidePanel，面向不支持侧边栏的 Chromium 内核）
// 见 docs/ARCHITECTURE.md 第 6.2 节。V1.0 只发布标准版，兼容版管道建成但随 V2.0 交付。
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
    name: 'TabHaven',
    description: 'A local-first side panel for organizing tabs in the current browser window.',
    minimum_chrome_version: '114',
    permissions: ['tabs', 'tabGroups', 'storage']
    // side_panel 字段与 sidePanel 权限由 WXT 检测 sidepanel 入口自动生成；
    // action 由 WXT 检测 popup 入口自动生成。标准版点击 action 打开侧边栏
    // 由 background 的 setPanelBehavior({ openPanelOnActionClick }) 控制，
    // default_popup 仅在右键图标时作为快速切换器入口（Chrome 平台行为）。
  }),
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      if (!isCompatVariant) return;

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
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  })
});
