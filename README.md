# Tabs

> **本地优先、无自有账号、无自有服务器的标签工作台**：把散乱的标签组织成有秩序的空间，并通过撤销、快照与归档降低误操作风险。

Tabs 是一个 Chrome / Edge 浏览器扩展（Manifest V3）。它只管理**当前窗口**的标签页，提供侧边栏式的组织、搜索、拖拽整理与关闭操作多层撤销——数据以浏览器本地存储为主，扩展本身不发起任何网络请求；固定集合与设置可经你自己的浏览器账号同步通道镜像（见隐私说明）。

- 无后端 · 无账号 · 无遥测 · 零网络请求
- 智能分组（同站点自动聚合，可选同步为原生标签组）
- 固定空间（文件夹 + 永久固定图标）
- 模糊搜索 + 键盘流（`Ctrl+Shift+F` / `⌘K`）
- 拖拽排序（标签 / 固定磁贴 / 分组头 / 固定文件夹），关闭操作可多层撤销
- 一键清理重复标签、安全休眠、JSON 数据导出导入

隐私详情见 [PRIVACY.md](./PRIVACY.md)。

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
pnpm typecheck        # 类型检查
pnpm lint             # 代码规范
pnpm test             # 行为规格 + UI 设计令牌守卫（Vitest）
pnpm check:privacy    # 隐私回归（权限/网络零 diff，需先 pnpm build）
```

加载已解压扩展：打开 `chrome://extensions` → 开启"开发者模式" → "加载已解压的扩展程序" → 选择 `./.output/chrome-mv3`。

---

## 功能一览（V1.0）

| 能力域     | 功能                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 标签视图   | 原生标签组、同站点自动聚合、未分组三区展示；n× 计数、静音、拆分视图徽章                                                                                                |
| 组织       | 固定文件夹（CRUD / 拖放排序 / 挂起转正 / 一键打开全部 / 存为书签）、永久固定图标（身份归一化、中键只关页）、从书签栏导入固定文件夹                                      |
| 搜索       | 标题 / 网址 / 拼音首字母模糊搜索，命中高亮，`↑↓` / `Enter` / `Esc` 键盘导航；可选扩展到所有窗口（跨窗口一键切换）                                               |
| 拖拽整理   | dnd-kit 驱动的标签/固定磁贴/分组头/固定条目排序；拖入固定空间与文件夹，重复 URL 自动去重                                                                                |
| 快捷入口   | 网页/链接/标签栏/工具栏图标右键菜单（休眠、固定、加入文件夹、按站点搜索）；地址栏`th` 命令直达标签/固定条目；工具栏角标（标签数 / 重复组数 / 休眠数）                 |
| 重复治理   | 一键清理重复标签（保留激活 / 固定 / 最早打开者）                                                                                                                        |
| 安全网     | 多层撤销栈（栈深 10，可恢复关闭的标签与分组）；撤销历史面板（任意批次恢复 + 浏览器最近关闭）；经本产品执行的关闭路径可撤销，恢复失败的条目保留在历史中可重试            |
| 会话快照   | 命名保存当前窗口 / 归档当前窗口（留档并关闭）/ 保存固定空间 / OneTab 文本导入；关窗自动快照（默认开启，滚动保留）；恢复仅新建缺失标签并还原固定/静音/分组；快照本地周报 |
| 休眠与资源 | 手动 / 批量 / 自动休眠（自动休眠可撤销、支持域名白名单）；一键唤醒全部；一键重置全部标签缩放                                                                            |
| 数据       | 完整备份导出导入 v2（固定空间 + 设置 + 全部快照与归档，导入为事务、失败整体回滚，兼容 v1 备份）；固定集合与设置经浏览器账号通道镜像同步（跨设备首启自动恢复）           |
| 平台       | 侧边栏主形态 + 弹窗快速切换器降级形态；中/英双语；主题三态（跟随系统/亮/暗）；自制弹窗组件；快捷键帮助面板（含浏览器设置跳转）                                          |

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
│   ├── site/            # SiteKey / HostRules / SiteResolver / SiteGrouping：同站点聚合
│   ├── fixed/           # PinIdentity / FolderOps / Reconcile：固定空间领域
│   ├── group/           # AutoGrouping：自动分组计划（纯决策）
│   ├── commands/        # folderCommands：固定文件夹纯计算
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

完整设计见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)，需求规格见 [docs/PRD.md](./docs/PRD.md)，产品与能力审计见 [docs/PRODUCT-DESIGN-CAPABILITY-AUDIT-2026-08-31.html](./docs/PRODUCT-DESIGN-CAPABILITY-AUDIT-2026-08-31.html)。

---

## 开发与测试

- **框架**：[WXT](https://wxt.dev)（MV3 扩展框架，提供 sidepanel 一等入口、多浏览器 target、entrypoint 级构建变体、Vitest 集成）
- **UI**：React 19 + TypeScript + Tailwind CSS
- **状态**：zustand
- **校验**：zod（所有持久化数据均经 schema 校验，坏数据隔离不扩散）
- **测试**：Vitest，行为规格测试（Given/When/Then 语义），当前 291 例（含 UI 渲染、性能规格回归与持久化失败注入用例）

```bash
pnpm dev        # 开发（HMR）
pnpm test       # 跑测试
pnpm typecheck  # 类型
pnpm lint       # lint
```

---

## 隐私

Tabs 的底线是**无自有服务器、无自有账号、无遥测、零出站网络请求**：数据以 `chrome.storage.local` 为主存储，固定集合与设置可经浏览器账号同步通道镜像。详见 [PRIVACY.md](./PRIVACY.md)。

---

## 商业模式：永久免费核心

Tabs 的护城河是「本地优先、零自有账号、无自有服务器」，因此**商业模式绝不引入自有云端账号或任何自建网络同步**（浏览器账号通道的镜像能力由浏览器提供，不由 Tabs 运营）。「永久免费核心」是产品宪法级承诺，商店页与文档均明示。可持续路径在以下三者中取舍（任一，不互斥）：

1. **开源 + 社区赞助**：核心代码开放，由社区赞助维持长期开发与隐私审计。
2. **一次性买断 Pro**：仅本地高级能力（自动化规则引擎、批量策略等）收费，**不破隐私、不联网、不订阅**。
3. **完全社区驱动**：纯社区维护，永久免费。

无论哪条路径，基础的组织 / 固定 / 归档 / 快照 / 撤销安全网等核心能力**永远免费**，且扩展本身不发起任何网络请求。

---
