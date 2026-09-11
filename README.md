# Tabs

> **本地优先、无自有账号、无自有服务器的标签工作台**：把散乱的标签组织成有秩序的空间，并通过撤销、快照与归档降低误操作风险。

Tabs 是一个 Chrome / Edge 浏览器扩展（Manifest V3）。它只管理**当前窗口**的标签页，提供侧边栏式的组织、搜索、拖拽整理与关闭操作多层撤销——数据以浏览器本地存储为主，扩展本身不发起任何网络请求；文件夹与设置可经你自己的浏览器账号同步通道镜像（见隐私说明）。

- 无后端 · 无账号 · 无遥测 · 零网络请求
- 智能分组（同域名自动聚合，可选同步为原生标签组）
- 固定空间（文件夹 + 常驻磁贴）
- 模糊搜索 + 键盘流（`Ctrl+Shift+F` / `⌘K`）
- 拖拽排序（标签 / 常驻磁贴 / 分组头 / 文件夹），关闭操作可多层撤销
- 一键清理重复标签、安全休眠、JSON 数据导出导入

隐私详情见 [PRIVACY.md](./PRIVACY.md)，版本变更记录见 [CHANGELOG.md](./CHANGELOG.md)，许可证见 [LICENSE](./LICENSE)。
漏洞报告见 [SECURITY.md](./SECURITY.md)，参与开发见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 安装

### 从 Chrome Web Store（推荐，待上架）

商店上架后，在扩展商店搜索 "Tabs" 一键安装。

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
pnpm check            # 一条命令跑全部：typecheck → lint → check:i18n → check:ui → test → build → check:privacy
```

各门禁也可单独执行（完整脚本表见下方「脚本一览」）：

| 命令                 | 作用                                                   |
| -------------------- | ------------------------------------------------------ |
| `pnpm typecheck`     | TypeScript 类型检查                                    |
| `pnpm lint`          | ESLint 代码规范                                        |
| `pnpm test`          | 行为规格 + UI 渲染 + 设计令牌守卫 + 性能回归（Vitest） |
| `pnpm check:i18n`    | 中英文案键集合一致性与死键检查                         |
| `pnpm check:ui`      | UI 设计令牌守卫（未受控调色板 / 字号 / 对比度）        |
| `pnpm check:privacy` | 隐私回归：权限冻结 + 零网络调用（需先 `pnpm build`）   |

加载已解压扩展：打开 `chrome://extensions` → 开启"开发者模式" → "加载已解压的扩展程序" → 选择 `./.output/chrome-mv3`。

---

## 功能一览（V1.0）

| 能力域     | 功能                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 标签视图   | 原生标签组、同域名自动聚合、未分组三区展示；n× 计数、静音、拆分视图徽章                                                                                                  |
| 组织       | 文件夹（CRUD / 拖放排序 / 挂起转正 / 一键打开全部 / 导出到书签）、常驻磁贴（身份归一化、中键只关页）、从书签栏导入文件夹                                                 |
| 搜索       | 标题 / 网址 / 拼音首字母模糊搜索，命中高亮，`↑↓` / `Enter` / `Esc` 键盘导航；可选扩展到所有窗口（跨窗口一键切换）                                                        |
| 拖拽整理   | dnd-kit 驱动的标签/常驻磁贴/分组头/文件夹条目排序；拖入固定空间与文件夹，重复 URL 自动去重                                                                               |
| 快捷入口   | 网页/链接/标签栏/工具栏图标右键菜单（休眠、固定、加入文件夹、按域名搜索）；地址栏 `t` 命令直达标签/固定条目；工具栏角标（标签数 / 重复组数 / 休眠数）                    |
| 重复治理   | 一键清理重复标签（每个网址保留激活 / 固定 / 位置靠前的一个；固定标签与固定空间内的条目豁免，可撤销）                                                                     |
| 安全网     | 多层撤销栈（栈深 10，可恢复关闭的标签与分组）；撤销历史面板（任意批次恢复 + 浏览器最近关闭）；经本产品执行的关闭路径可撤销，恢复失败的条目保留在历史中可重试             |
| 会话快照   | 命名保存当前窗口 / 归档当前窗口（留档并关闭）/ 保存固定空间 / OneTab 文本导入；关窗自动快照（默认开启，滚动保留）；恢复仅新建缺失标签并还原固定/静音/分组；快照本地周报  |
| 休眠与资源 | 手动 / 批量 / 自动休眠（自动休眠可撤销、支持域名白名单）；一键唤醒全部                                                                                                   |
| 数据       | 完整备份导出导入（固定空间 + 设置 + 全部快照与归档，导入为事务、失败整体回滚；单一备份格式，格式不符即拒绝）；文件夹与设置经浏览器账号通道镜像同步（跨设备首启自动恢复） |
| 平台       | 侧边栏主形态 + 弹窗快速切换器降级形态；中/英双语；主题三态（跟随系统/亮/暗）；自制弹窗组件；快捷键帮助面板（含浏览器设置跳转）                                           |

> 注：V1.0 只发布标准版（侧边栏形态）。兼容变体的构建管道已建成，随 V2.0 交付。

---

## 架构

Tabs 采用分层架构：**领域逻辑（core）零 chrome/DOM 依赖，是唯一需要单测的层**；platform 层是唯一触碰 `chrome.*` 的边界；多层形态（sidepanel / popup / options）共享同一套 core 与状态层，每个入口只是不同的 React 根。

```
src/
├── entrypoints/        # 形态入口（薄壳）
│   ├── background.ts    # SW：重复标签复用引擎 + commands 分发 + 消息端点
│   ├── sidepanel/       # 侧边栏主形态
│   ├── popup/           # 弹窗快速切换器（降级形态）
│   └── options/         # 设置 / 本地数据导入导出
├── core/               # 纯领域逻辑（零 chrome/DOM 依赖，单测主战场）
│   ├── url/             # UrlInspector：URL 规约 + 分类（全应用 URL 判定唯一事实来源）
│   ├── dup/             # DuplicateIndex + KeeperPolicy：重复组索引与 keeper 策略
│   ├── site/            # SiteKey / HostRules / SiteResolver / SiteGrouping：同域名聚合（代码层沿用 site 命名）
│   ├── fixed/           # PinIdentity / FolderOps / Reconcile：固定空间领域
│   ├── group/           # AutoGrouping：自动分组计划（纯决策）
│   ├── commands/        # folderCommands：文件夹纯计算
│   ├── search/          # SearchEngine：fuzzysort + pinyin-pro 三目标索引
│   ├── undo/            # UndoStack：操作记录制 + 栈深淘汰
│   ├── util/            # structuralSignature 等通用工具
│   └── schema/          # zod schema 族 + 导出文件格式
├── platform/           # chrome 适配层（唯一触碰 chrome.* 的层）
│   ├── tabs.ts          # 标签查询 / 事件聚合 / 操作
│   ├── reuse/           # AllowanceLedger / ReusePolicy / ReuseCoordinator：复用引擎
│   ├── sync/            # TabSyncService：事件→快照节流调度
│   ├── storage/         # DataRepository：zod 校验读写 + 坏数据隔离 + 变更订阅
│   ├── snapshot/        # 快照构建 / 裁剪 / 持久化 / 恢复 / OneTab 解析
│   ├── theme/           # ThemeApplier：主题三态落地
│   ├── undo/            # RestoreEngine：撤销恢复管线
│   ├── messages.ts      # 类型安全消息协议（zod）
│   └── capabilities.ts  # 形态能力检测
├── stores/             # zustand store 族（tab / undo / data / snapshot）
├── ui/                 # React 组件库（common / tabs / fixed / search / dialog）
├── i18n/               # UI 文案（react-i18next）
├── theme-init.ts       # 头部同步主题，避免闪烁
└── styles/             # Tailwind + CSS 变量
```

分层约束（改动前请先对照）：

1. `core/**` 不得出现 `chrome.*` / `browser.*` / DOM / React，也不得 import `platform/**`；
2. `platform/**` 是唯一触碰 `chrome.*` 的层，`ui/**` 不得绕过它直连浏览器 API；
3. 所有持久化数据必须经 `core/schema` 的 zod schema 校验，坏数据隔离而非静默丢弃；
4. 权限清单冻结在 `wxt.config.ts` 与 `PRIVACY.md`，新增权限须先改这两处并通过 `pnpm check:privacy`。

---

## 开发与测试

- **框架**：[WXT](https://wxt.dev)（MV3 扩展框架，提供 sidepanel 一等入口、多浏览器 target、entrypoint 级构建变体、Vitest 集成）
- **UI**：React 19 + TypeScript + Tailwind CSS
- **状态**：zustand
- **校验**：zod（所有持久化数据均经 schema 校验，坏数据隔离不扩散）
- **测试**：Vitest，行为规格测试（Given/When/Then 语义），覆盖 core 纯函数、platform 适配层、store 事务、UI 渲染、设计令牌守卫、性能回归与持久化失败注入

### 脚本一览

| 命令                                                             | 作用                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:edge`                                     | 开发模式（HMR；后者以 Edge 为目标浏览器）                                         |
| `pnpm build` / `pnpm build:compat`                               | 生产构建（标准版 / 兼容版）                                                       |
| `pnpm zip`                                                       | 打包为上架用 ZIP                                                                  |
| `pnpm check`                                                     | 聚合门禁：typecheck → lint → check:i18n → check:ui → test → build → check:privacy |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm test:watch` | 类型 / 规范 / 测试                                                                |
| `pnpm check:ui` / `pnpm check:i18n` / `pnpm check:privacy`       | 设计令牌 / 文案键 / 隐私回归                                                      |
| `pnpm format`                                                    | Prettier 格式化                                                                   |

---

## 隐私

Tabs 的底线是**无自有服务器、无自有账号、无遥测、零出站网络请求**：数据以 `chrome.storage.local` 为主存储，文件夹与设置可经浏览器账号同步通道镜像。详见 [PRIVACY.md](./PRIVACY.md)。

---

## 商业模式：永久免费核心

Tabs 的护城河是「本地优先、零自有账号、无自有服务器」，因此**商业模式绝不引入自有云端账号或任何自建网络同步**（浏览器账号通道的镜像能力由浏览器提供，不由 Tabs 运营）。「永久免费核心」是产品宪法级承诺，商店页与文档均明示。可持续路径在以下三者中取舍（任一，不互斥）：

1. **开源 + 社区赞助**：核心代码开放，由社区赞助维持长期开发与隐私审计。
2. **一次性买断 Pro**：仅本地高级能力（自动化规则引擎、批量策略等）收费，**不破隐私、不联网、不订阅**。
3. **完全社区驱动**：纯社区维护，永久免费。

无论哪条路径，基础的组织 / 固定 / 归档 / 快照 / 撤销安全网等核心能力**永远免费**，且扩展本身不发起任何网络请求。

---

## 许可证

Tabs 采用 [MIT 许可证](./LICENSE) 开源。

---

## 参与贡献

提交前请跑通聚合门禁（CI 的本地等价物；CI 另跑 `format:check` 与 `pnpm audit`）：

```bash
pnpm check    # typecheck → lint → check:i18n → check:ui → test → build → check:privacy
pnpm format:check
```

改动还须满足以下约定：

- `core/**` 保持零 `chrome.*` / DOM / React 依赖，且不 import `platform/**`；
- 持久化数据的形状变更必须同步 `core/schema` 的 zod schema 与 `CHANGELOG.md`；
- 新增权限必须同时改 `wxt.config.ts` 与 `PRIVACY.md`，否则 `check:privacy` 会失败；
- 新增 UI 文案必须同时补 `zh-CN` 与 `en` 两份 locale，否则 `check:i18n` 会失败。

---
