# TabHaven（页港）

> **本地优先、无账号、无云端的标签工作台**：把散乱的标签组织成有秩序的空间，并通过撤销与本地备份降低误操作风险。

TabHaven 是一个 Chrome / Edge 浏览器扩展（Manifest V3）。它只管理**当前窗口**的标签页，提供侧边栏式的组织、搜索、批量操作与多层撤销——所有数据留在你的设备里，永不上传。

- 无后端 · 无账号 · 无遥测 · 零网络请求
- 智能分组（同站点自动聚合，可选同步为原生标签组）
- 固定空间（文件夹 + 永久固定图标）
- 模糊搜索 + 键盘流（`Ctrl+Shift+F` / `⌘K`）
- 多选批量操作、多层可撤销
- 一键清理重复标签、安全休眠、JSON 数据导出导入

隐私详情见 [PRIVACY.md](./PRIVACY.md)。

---

## 安装

### 从 Chrome Web Store（推荐，待上架）

商店上架后，在扩展商店搜索 "TabHaven" 一键安装。

### 从源码构建（开发者）

```bash
# 1. 安装依赖
pnpm install

# 2. 开发模式（热重载，加载 .output/chrome-mv3 到 chrome://extensions 的"开发者模式"）
pnpm dev

# 3. 生产构建
pnpm build            # 标准版（Chrome/Edge/Brave，含侧边栏）
pnpm build:compat     # 兼容版（旧内核 Chromium，降级为弹窗形态）

# 4. 打包为 ZIP 以便上架
pnpm zip

# 5. 质量门禁
pnpm typecheck        # 类型检查
pnpm lint             # 代码规范
pnpm test             # 行为规格测试（Vitest）
python3 scripts/privacy_check.py   # 隐私回归（权限/网络/数据三项零 diff）
```

加载已解压扩展：打开 `chrome://extensions` → 开启"开发者模式" → "加载已解压的扩展程序" → 选择 `./.output/chrome-mv3`。

---

## 功能一览（V1.0）

| 能力域   | 功能                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| 标签视图 | 原生标签组、同站点自动聚合、未分组三区展示；n× 计数、静音、拆分视图徽章                   |
| 组织     | 固定文件夹（CRUD / 拖放排序 / 挂起转正）、永久固定图标（身份归一化、中键只关页）           |
| 搜索     | 标题 / 网址 / 拼音首字母模糊搜索，命中高亮，`↑↓` / `Enter` / `Esc` 键盘导航        |
| 多选批量 | 选择模式（`Shift` 连选、`Cmd` 点选、`Ctrl+A` 全选）、批量关闭/固定/静音/移入文件夹   |
| 重复治理 | 一键清理重复标签（保留激活 / 固定 / 最早打开者）                                           |
| 安全网   | 多层撤销栈（栈深 10，可恢复关闭的标签与分组）；所有关闭路径可撤销                          |
| 数据     | 固定空间与设置的 JSON 版本化导出导入（不包含当前打开标签）                                   |
| 平台     | 侧边栏主形态 + 弹窗快速切换器降级形态；中/英双语；主题三态（跟随系统/亮/暗）；自制弹窗组件 |

> 注：V1.0 只发布标准版（侧边栏形态）。兼容变体的构建管道已建成，随 V2.0 交付。

---

## 架构

TabHaven 采用分层架构：**领域逻辑（core）零 chrome/DOM 依赖，是唯一需要单测的层**；platform 层是唯一触碰 `chrome.*` 的边界；多层形态（sidepanel / popup / options）共享同一套 core 与状态层，每个入口只是不同的 React 根。

```
src/
├── entrypoints/        # 形态入口（薄壳）
│   ├── background.ts    # SW：重复标签复用引擎 + commands 分发 + 消息端点
│   ├── sidepanel/       # 侧边栏主形态
│   ├── popup/           # 弹窗快速切换器（降级形态）
│   └── options/         # 设置 / 本地数据导入导出
├── core/               # 纯领域逻辑（零 chrome/DOM 依赖，单测主战场）
│   ├── url/             # UrlInspector：URL 规约 + 分类
│   ├── dup/             # DuplicateIndex + KeeperPolicy：重复组索引与 keeper 策略
│   ├── site/            # SiteKey / HostRules / SiteResolver / SiteGrouping：同站点聚合
│   ├── fixed/           # PinIdentity / FolderOps / Reconcile：固定空间领域
│   ├── search/          # SearchEngine：fuzzysort + pinyin-pro 三目标索引
│   ├── undo/            # UndoStack：操作记录制 + 栈深淘汰
│   └── schema/          # zod schema 族 + 导出文件格式
├── platform/           # chrome 适配层（唯一触碰 chrome.* 的层）
│   ├── tabs.ts          # 标签查询 / 事件聚合 / 操作
│   ├── reuse/           # AllowanceLedger / ReusePolicy / ReuseCoordinator：复用引擎
│   ├── sync/            # TabSyncService：事件→快照节流调度
│   ├── storage/         # DataRepository：zod 校验读写 + 坏数据隔离 + 变更订阅
│   ├── theme/           # ThemeApplier：主题三态落地
│   ├── undo/            # RestoreEngine：撤销恢复管线
│   ├── messages.ts      # 类型安全消息协议（zod）
│   └── capabilities.ts  # 形态能力检测
├── stores/             # zustand store 族（tab / selection / undo / data / ui）
├── ui/                 # React 组件库（common / tabs / fixed / search / dialog）
├── i18n/               # UI 文案（react-i18next）
├── theme-init.ts       # 头部同步主题，避免闪烁
└── styles/             # Tailwind + CSS 变量
```

完整设计见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)，需求规格见 [docs/PRD.md](./docs/PRD.md)，开发计划见 [docs/DEVELOPMENT_PLAN.md](./docs/DEVELOPMENT_PLAN.md)。

---

## 开发与测试

- **框架**：[WXT](https://wxt.dev)（MV3 扩展框架，提供 sidepanel 一等入口、多浏览器 target、entrypoint 级构建变体、Vitest 集成）
- **UI**：React 18 + TypeScript + Tailwind CSS
- **状态**：zustand
- **校验**：zod（所有持久化数据均经 schema 校验，坏数据隔离不扩散）
- **测试**：Vitest，行为规格测试（Given/When/Then 语义），当前 83 例

```bash
pnpm dev        # 开发（HMR）
pnpm test       # 跑测试
pnpm typecheck  # 类型
pnpm lint       # lint
```

---

## 隐私

TabHaven 的底线是**数据不离设备**：无后端、无账号、无遥测、零网络请求。所有数据存于浏览器本地存储（`chrome.storage.local`）。详见 [PRIVACY.md](./PRIVACY.md)。

---

## 许可证

MIT
