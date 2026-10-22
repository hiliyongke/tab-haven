# Tabs

> **本地优先、无自有账号、无自有服务器的标签工作台**：把散乱的标签组织成有秩序的空间，并通过撤销、快照与归档降低误操作风险。

Tabs 是一个 Chrome / Edge 浏览器扩展（Manifest V3）。它默认只管理**当前窗口**的标签页（其他窗口可在设置中开启后查看，并可切换或关闭——关闭同样进撤销栈，可反悔），提供侧边栏式的组织、搜索、拖拽整理与关闭操作多层撤销——数据以浏览器本地存储为主，扩展本身不发起任何网络请求；文件夹、常驻磁贴与设置可经你自己的浏览器账号同步通道镜像（见隐私说明）。

- 无后端 · 无账号 · 无遥测 · **零出站网络请求（无任何例外）**：站点图标取自浏览器自己的本地图标库（本扩展的 `chrome-extension://<id>/_favicon/` 通道），不向被浏览站点发起任何请求（详见 PRIVACY.md 第 1 节）
- 智能分组（同域名自动聚合，可选同步为原生标签组）
- 收藏夹（文件夹 + 常驻磁贴）
- 模糊搜索 + 键盘流（`Ctrl+Shift+F` / `⌘K`）
- 拖拽排序（标签 / 常驻磁贴 / 分组头 / 文件夹），关闭操作可多层撤销
- 一键清理重复标签、安全休眠、JSON 数据导出导入

隐私详情见 [PRIVACY.md](./PRIVACY.md)；本仓库当前不对外开源，许可条款见文末「许可证」。
漏洞报告见 [SECURITY.md](./SECURITY.md)，参与开发见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 安装

### 从 Chrome Web Store（推荐，待上架）

商店上架后，在扩展商店搜索 "Tabs" 一键安装。

上架前需准备的材料（商店文案、权限理由、隐私政策 URL、截图）与发布前自查清单统一维护在 [`CHROMEWEBSTORE.md`](./CHROMEWEBSTORE.md)；打包用 `pnpm zip`（WXT 只打入口产物与 `public/`，不含 `docs/`、`.codebuddy/`、`tests/` 等开发文件）。

### 从源码构建（开发者）

前置条件（版本不一致会出现本地无法复现的失败）：

| 项       | 要求                        | 依据                                                                    |
| -------- | --------------------------- | ----------------------------------------------------------------------- |
| 浏览器   | Chrome / Edge / Brave ≥ 114 | `wxt.config.ts` 的 `minimum_chrome_version`；低于此版本侧边栏 API 不全  |
| Node.js  | ≥ 26                        | `package.json` 的 `engines.node`；`.nvmrc` 已固定为 26，CI 读同一份     |
| 包管理器 | pnpm 11.1.3                 | `package.json` 的 `packageManager`；用 npm/yarn 装会绕过 workspace 链接 |

```bash
# 1. 安装依赖
pnpm install

# 2. 开发模式（热重载，加载 .output/chrome-mv3 到 chrome://extensions 的"开发者模式"）
pnpm dev

# 3. 生产构建
pnpm build            # Chrome/Edge/Brave（含侧边栏）

# 4. 打包为 ZIP 以便上架
pnpm zip

# 5. 质量门禁
pnpm check            # 一条命令跑全部：typecheck → lint → check:i18n → check:ui → test → build → check:privacy
```

各门禁也可单独执行，完整脚本表见 [脚本一览](#脚本一览)。

加载已解压扩展：打开扩展管理页（`chrome://extensions`，Edge 为 `edge://extensions`）→ 开启"开发者模式" → "加载已解压的扩展程序" → 选择 `.output/chrome-mv3`。

> **不需要为 Edge 单独打包**：实测 `wxt build -b edge` 与 Chrome 变体的 `manifest.json`、`background.js`、文件清单**字节级一致**（`wxt.config.ts` 的 `build:manifestGenerated` hook 没有做浏览器变体裁剪）。Edge 与 Chrome/Brave 共用同一个包，唯一的区别是扩展管理页地址。将来若要上架 Edge Add-ons，需按该商店流程单独提交（那是商店要求，不是包内容差异）。

---

## 功能一览（v1.0）

| 能力域     | 功能                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 标签视图   | 原生标签组、同域名自动聚合、未分组三区展示；n× 计数、静音、拆分视图徽章                                                                                                                                                                                                                                                                                               |
| 组织       | 文件夹（CRUD / 拖放排序 / 挂起转正 / 一键打开全部 / 导出到书签）、常驻磁贴（身份归一化、中键只关页）、从书签栏导入文件夹；工作区切换（命令面板键入文件夹名，一键打开该「空间」全部缺失条目，P-04「文件夹即空间」轻量验证）                                                                                                                                            |
| 搜索       | 标题 / 网址 / 拼音首字母模糊搜索，命中高亮，`↑↓` / `Enter` / `Esc` 键盘导航；可选扩展到所有窗口（跨窗口一键切换）；时间线搜索（搜索框内「含历史」开关，同时命中最近 20 份快照与归档条目，支持仅打开单个 URL 或整快照恢复）；命令面板（⌘/Ctrl+P：命令 + 标签切换 + 文件夹空间三组漫游）                                                                                |
| 拖拽整理   | dnd-kit 驱动的标签/常驻磁贴/分组头/文件夹条目排序；标签拖到原生分组头即加入该组、拖入收藏夹与文件夹（重复 URL 自动去重）、拖到磁贴区固定，磁贴拖回标签区取消固定；不支持的落点在拖拽过程中即显示禁用态并说明原因                                                                                                                                                      |
| 快捷入口   | 网页/链接/标签栏/工具栏图标右键菜单（休眠、固定、加入文件夹、按域名搜索）；地址栏 `t` 命令直达标签/固定条目；工具栏角标（标签数 / 重复组数，休眠数见悬停提示）                                                                                                                                                                                                        |
| 重复治理   | 一键清理重复标签（每个网址保留最近访问 / 激活 / 固定 / 位置靠前的一个；固定标签与收藏夹内的条目豁免，可撤销）                                                                                                                                                                                                                                                         |
| 安全网     | 多层撤销栈（栈深 10，可恢复关闭的标签与分组）；撤销历史面板（任意批次恢复 + 浏览器最近关闭）；经本产品执行的关闭路径可撤销，恢复失败的条目保留在历史中可重试                                                                                                                                                                                                          |
| 会话快照   | 命名保存当前窗口 / 归档当前窗口（留档并关闭）/ 保存收藏夹 / OneTab 文本导入 / Workona 迁移器（导出 JSON 一键转快照族：普通/归档工作区、resources 站点收藏并入、仅 http(s)、1MB 上限）；关窗自动快照（默认开启，滚动保留）；恢复仅新建缺失标签并还原固定/静音/分组；恢复前 diff 预览（将新建 / 已存在 / 跳过三分类与计数摘要，可勾选部分条目选择性恢复）；快照本地周报 |
| 习惯洞察   | 标签习惯洞察（快照周报内嵌，纯本地计算零上报）：重复重灾区按站点聚合（www 归一化）、休眠候选（排除激活/固定/播放/绑定）、7 天滞留预警；三类洞察一键直达清理重复/一键休眠/归档窗口既有动作                                                                                                                                                                             |
| 休眠与资源 | 手动 / 批量 / 自动休眠（自动休眠可撤销、支持域名白名单）；一键唤醒全部                                                                                                                                                                                                                                                                                                |
| 数据       | 完整备份导出导入（收藏夹 + 设置 + 全部快照与归档，导入为事务、失败整体回滚；单一备份格式，格式不符即拒绝）；文件夹、常驻磁贴与设置经浏览器账号通道镜像同步（**默认关闭**，跨设备首启自动恢复）                                                                                                                                                                        |
| 平台       | 侧边栏为主形态（点击工具栏图标即打开）；中/英双语；主题三态（跟随系统/亮/暗）；自制弹窗组件；快捷键帮助面板（含浏览器设置跳转）                                                                                                                                                                                                                                       |
| 信任       | 权限与用途（关于页）：全部权限与可选主机权限逐条用途说明、数据存放位置说明、DevTools 零网络请求自验证教程（用户可自行验证「零网络」这一承诺）                                                                                                                                                                                                                         |

> 注：本版（v1.0）包含时间线搜索、快照恢复预览与选择性恢复、权限与用途说明、工作区切换入口、习惯洞察、Workona 迁移器，均不新增权限、不新增上报。本产品尚未在应用商店上架，代码内不保留任何版本兼容 / 迁移逻辑（备份格式单一、无跨版本解析、无设置迁移）。

---

## 架构

Tabs 采用分层架构：**领域逻辑（core）零 chrome/DOM 依赖，是唯一需要单测的层**；platform 层是唯一触碰 `chrome.*` 的边界；三种形态（sidepanel / options / about）共享同一套 core 与状态层，每个入口只是不同的 React 根。

仓库是标准 pnpm workspace，`apps` 放可部署应用、`packages` 放库，**根 `package.json` 只做编排转发**（不含产品代码与产品依赖）：

```
apps/extension/   # 扩展本体（src / public / i18n / tests / scripts + 自己的 wxt、tsconfig、eslint、vitest 配置）
apps/site/        # 产品官网（独立工程，见「产品官网」小节）
packages/i18n-kit/# 文案工具库（自带 tests/）
tests/            # 跨包守卫（依赖单副本）
```

扩展包内的分层结构：

```
apps/extension/src/
├── entrypoints/        # 形态入口（薄壳）
│   ├── background.ts    # SW：事件编排 + commands 分发 + 消息端点（子模块全部在 platform/background/）
│   ├── sidepanel/       # 侧边栏（唯一交互形态，点击工具栏图标打开）
│   ├── options/         # 设置 / 本地数据导入导出
│   └── about/           # 关于与信任面板
├── core/               # 纯领域逻辑（零 chrome/DOM 依赖，单测主战场）
│   ├── url/             # UrlInspector：URL 规约 + 分类（全应用 URL 判定唯一事实来源）
│   ├── dup/             # DuplicateIndex + KeeperPolicy：重复组索引与 keeper 策略
│   ├── site/            # SiteKey / HostRules / SiteResolver / SiteGrouping：同域名聚合（代码层沿用 site 命名）
│   ├── fixed/           # PinIdentity / FolderOps / Reconcile：固定空间（UI 文案为「收藏夹」）领域
│   ├── group/           # AutoGrouping：自动分组计划（纯决策）
│   ├── commands/        # folderCommands：文件夹纯计算
│   ├── search/          # SearchEngine：fuzzysort + pinyin-pro 三目标索引
│   ├── snapshot/        # snapshotDiff：快照恢复前 diff 预览
│   ├── undo/            # UndoStack：操作记录制 + 栈深淘汰
│   ├── insights/        # tabInsights：习惯洞察 + workonaImport：Workona 迁移解析
│   ├── nocache/         # noCachePattern：禁缓存站点规则归一化
│   ├── theme/           # colorThemes：主题标识
│   ├── util/            # concurrency / filename / id / signature 等通用工具
│   ├── tab-types.ts     # TabRecord / TabGroupRecord 等领域类型
│   ├── tabSelectors.ts  # 清理重复 / 休眠候选 / 可归档的纯选择器
│   └── schema/          # models.ts：zod schema 族 + 导出文件格式（校验唯一口径）
├── platform/           # chrome 适配层（唯一触碰 chrome.* 的层）
│   ├── tabs.ts          # 标签查询 / 事件聚合 / 操作
│   ├── reuse/           # AllowanceLedger / ReusePolicy / ReuseCoordinator：复用引擎
│   ├── sync/            # TabSyncService：事件→快照节流调度
│   ├── storage/         # DataRepository：zod 校验读写 + 坏数据隔离 + 变更订阅
│   ├── snapshot/        # 快照构建 / 裁剪 / 持久化 / 恢复 / OneTab 解析
│   ├── undo/            # RestoreEngine：撤销恢复管线
│   ├── group/           # 原生标签组适配
│   ├── nocache/         # declarativeNetRequest 动态规则
│   ├── theme/           # ThemeApplier：主题三态落地
│   ├── bookmarks.ts / sessions.ts / sidePanel.ts / navigation.ts / permissions.ts
│   ├── clipboard.ts     # 剪贴板（ui 不得直连 navigator.clipboard）
│   ├── favicon.ts       # 站点图标走浏览器本地 _favicon 通道
│   ├── diagnostics.ts   # 降级诊断（环形缓冲 + 脱敏，供设置页导出）
│   ├── log.ts           # 诊断内核：脱敏 + 环形缓冲 + 投递
│   ├── messages.ts      # 类型安全消息协议（zod）
│   └── registry.ts      # 组合根：仓库实例装配
├── stores/             # zustand store 族（dataStore / tabStore / undoStore / snapshotStore + data/ 切片）
├── ui/                 # React 组件库（common / tabs / fixed / search / dialog / dnd）
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
| `pnpm build`                                                     | 生产构建                                                                          |
| `pnpm zip`                                                       | 打包为上架用 ZIP                                                                  |
| `pnpm crx`                                                       | 打包离线分发用 CRX3（复用 `.output/tabs.pem` 签名；上架仍用 zip）                 |
| `pnpm site:dev`                                                  | 官网开发预览：端口 5174（中文 `/`、英文 `/en/`）                                  |
| `pnpm site:build`                                                | 官网构建：预渲染中英两份静态页 + 拷入下载包 + 零外链自检，产物 `apps/site/dist`   |
| `pnpm site:preview`                                              | 预览官网产物 `apps/site/dist`，端口 5175                                          |
| `pnpm site:i18n`                                                 | 官网文案一条龙：抽词 → 编译词条 → 跑守卫（独立词典 `apps/site/i18n/`）            |
| `pnpm site:check`                                                | 官网门禁：typecheck → lint → i18n → build（不并入 `pnpm check`）                  |
| `pnpm check`                                                     | 聚合门禁：typecheck → lint → check:i18n → check:ui → test → build → check:privacy |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm test:watch` | 类型 / 规范 / 测试                                                                |
| `pnpm check:ui` / `pnpm check:i18n` / `pnpm check:privacy`       | 设计令牌 / 文案 / 隐私回归                                                        |
| `pnpm i18n`                                                      | 文案一条龙：扫描源码抽词 → 编译词条 → 跑守卫（写中文后跑它）                      |
| `pnpm i18n:scan` / `i18n:apply` / `i18n:lint`                    | 分步：抽词 / 编译进运行时 / 检查裸露中文                                          |
| `pnpm i18n:report`                                               | 发布前文案盘点：只出报告不判失败                                                  |
| `pnpm format` / `pnpm format:check`                              | Prettier 格式化 / 只校验不写入                                                    |

> 每个命令的用途、产出与注意事项见 `package.json` 的 `scriptDocs` 字段（JSON 不支持注释，说明集中放在那里，此处只列简表）。

### 文案（i18n）体系

写业务代码时**只写中文**，不用想 key、不用先去词条文件登记：

```tsx
const { t } = useTranslation();
t('外观与布局');
t('共 {{count}} 个标签', { count: n }); // 带插值：整句 + 占位符
<Trans>
  已选 <Slot content={count} /> 个标签
</Trans>; // 中间夹组件：整句翻译
t('打开', { context: 'verb' }); // 同句不同语境：context 参与 key
```

运行时按原文算出哈希 key（`i18n_1a2b3c4`）查词典，查不到就回退原文。哈希算法在工具包里
**单一实现**（`packages/i18n-kit/src/hashKey.ts`），扫描器与两条运行时轨道（UI / 后台）都
import 它——抄一份就一定会漂移，而漂移的表现是「英文模式整片露中文且查不出原因」。

工具链已抽成独立包 **`packages/i18n-kit`**（自研，不绑定本产品），其它项目可直接引用：
`i18n-kit scan | apply | check | lint | migrate`，详见
[packages/i18n-kit/README.md](./packages/i18n-kit/README.md)。

#### 日常流程

写中文 → 跑一条命令 → 补译文：

```bash
pnpm i18n          # = i18n-kit scan && apply && check
```

译文补齐走**本地文件**（本产品零出站网络，不接任何翻译平台）：扫描器把缺译的词条写进
`apps/extension/i18n/untranslated/en.json`，翻译完填回 `apps/extension/i18n/translation/en.json`，再跑 `pnpm i18n` 编译进运行时。

#### 目录职责

| 路径                                       | 谁维护     | 说明                                     |
| ------------------------------------------ | ---------- | ---------------------------------------- |
| `apps/extension/i18n/source/zh-CN.json`    | 扫描器     | 母语原文词典（哈希 key → 中文），勿手改  |
| `apps/extension/i18n/translation/en.json`  | 人 / 流程  | 译文（键与 source 对齐）                 |
| `apps/extension/i18n/untranslated/en.json` | 生成物     | 待翻译清单                               |
| `apps/extension/i18n/retired/en.json`      | 生成物     | 失效词条的译文归档（改回旧文案时可复用） |
| `apps/extension/src/i18n/locales/*`        | apply 生成 | 运行时资源，**平铺**、**勿手改**         |

全部词条一律是哈希 key（键由原文摘要生成，源码里只写中文原文）。

#### 守卫

`pnpm check:i18n` = `i18n-kit check` + `i18n-kit lint`，任一不满足即失败：

1. **产物已编译**：`apps/extension/src/i18n/locales/*` 必须与词典一致（改了词典没跑 apply，界面仍是旧文案）；
2. **无孤立译文**：译文文件里不得有词典中不存在的 key；
3. **无未登记原文**：源码里 `t('中文')` 的原文必须已在词典里——未登记即**英文模式露中文**；
4. **无伪翻译**：en 不得为空 / 与原文相同 / 汉字占比过高（语言名显示本名、英文语序不需要的量词等已白名单豁免）；
5. **白名单不过期**：豁免的原文若已消失即失败（否则豁免形同虚设）。

另有 `pnpm i18n:lint`（已并入 `check:i18n`）检查**未被词典接管的裸露中文**：JSX 裸文本、
直接渲染的字符串常量、模板串里的中文。诊断日志（`logFailure` / `logDegraded`）不计入——
那是给开发者看的，不进界面；其余确属豁免的就近写 `// @i18n-ignore` 说明理由。

**发布前想知道还有哪些没翻译**：

```bash
pnpm i18n:report
```

退出码恒为 0，只出报告不判失败。产出 `apps/extension/i18n/report.md`（人读：概览 + 待翻译 / 未登记 / 豁免分区清单）
与 `apps/extension/i18n/untranslated/en.json`（机读）。报告与待翻译清单是生成物，已在 `.gitignore` 中忽略；
`apps/extension/i18n/source`、`apps/extension/i18n/translation`、`apps/extension/i18n/retired` 是词典源，**必须入库**。

---

## 隐私

Tabs 的底线是**无自有服务器、无自有账号、无遥测、零出站网络请求**：数据以 `chrome.storage.local` 为主存储，文件夹、常驻磁贴与设置可经浏览器账号同步通道镜像。详见 [PRIVACY.md](./PRIVACY.md)。

---

## 商业模式

当前版本全部核心能力免费，扩展本身不发起任何网络请求；商店文案与对外口径见 [`CHROMEWEBSTORE.md`](./CHROMEWEBSTORE.md)。

---

## 许可证

**Tabs 当前不对外开源**，仓库保持私有，暂不授予任何使用、复制或再分发许可
（各 `package.json` 的 `license` 字段已相应置为 `UNLICENSED`）。

对外一致的口径是：官网与商店文案均不得出现开源 / 许可声明；等真正开源时，
再补许可条款并同步官网页脚、首屏徽章与结尾 CTA 三处（它们的许可行已按此口径移除）。

---

## 文档

| 文档                                       | 用途                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| [`CHROMEWEBSTORE.md`](./CHROMEWEBSTORE.md) | **上架唯一来源**：商店文案、每项权限理由、隐私披露、版本历史、发布前自查 |
| [`CHANGELOG.md`](./CHANGELOG.md)           | 版本记录                                                                 |

隐私边界以根目录 [PRIVACY.md](./PRIVACY.md) 为唯一对外口径，开发约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 产品官网

官网是仓库内的**独立工程** `apps/site/`：自带 `package.json` / `vite.config.ts` / `tsconfig.json` / `eslint.config.js`，作为 pnpm workspace 成员（`- apps/*`）装自己的依赖。目录按「apps 放可部署应用、packages 放库」划分，它与扩展的三条边界是刻意划清的：

- **不在 `packages/` 下** —— `apps/extension/scripts/privacy-check.mjs` 会扫描 `packages/` 下的全部 `.ts/.tsx`（扩展发布门禁），官网不该被它收编；
- **不在 `apps/extension/public/` 下** —— 否则会被 WXT 打进扩展包，同样会被 `pnpm check:privacy` 扫到；
- **不进扩展门禁** —— 扩展的类型与 lint 配置随包走（`apps/extension/tsconfig.json`、`apps/extension/eslint.config.js`，只作用于本包），根 ESLint 忽略整个 `apps/**`；`pnpm check` 不受官网影响；
- **词典独立** —— 官网词条在 `apps/site/i18n/`，与扩展的 `apps/extension/i18n/` 互不影响（同一套 `i18n-kit` 工具，不同 `--root`）。

### 本地预览

```bash
pnpm site:dev      # http://localhost:5174/ （英文 http://localhost:5174/en/）
pnpm site:preview  # 预览已构建产物，http://localhost:5175/
```

端口 5174 是为了避开扩展 `pnpm dev` 占用的 3000，两者可以同时开着。

### 构建与发布

```bash
pnpm build && pnpm zip   # 先产出扩展包（下载按钮指向它）
pnpm site:build          # 再构建官网；产物 apps/site/dist 可直接整体上传
```

产物：`index.html`（中文）、`en/index.html`（英文）、`robots.txt`、`download/tabs-<version>.zip`。下载包由 `apps/site/build.mjs` 从 `apps/extension/.output/*.zip` 拷入（按版本号精确匹配），缺失时只告警不阻断构建。

**发布前必须做的一件事**：把真实域名填进 `apps/site/site.config.ts` 的 `SITE_URL`。留空时构建会跳过 canonical / hreflang / JSON-LD 与 `sitemap.xml` 并打印告警 —— 宁可缺标签，也不能把占位域名发出去。

### 实现要点

| 项       | 做法                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 渲染     | 构建期预渲染：React 只在构建期跑 `renderToStaticMarkup`，**产物不含 React 运行时**（客户端只有 1 份 CSS + 约 1KB 行为脚本）                                                            |
| 样式     | 手写 CSS + 设计令牌；令牌值照搬 `apps/extension/src/styles/main.css`（品牌绿 `#347554`、暖调画布 `#f5f4f0`、石墨灰阶、暖调阴影、同一条动效曲线），见 `apps/site/src/styles/tokens.css` |
| 演示区   | 侧边栏界面由 CSS 绘制（仓库没有真实截图），四帧可切换，零图片请求                                                                                                                      |
| 文案     | 源码只写中文，跑 `pnpm site:i18n`；英文译文人工填 `apps/site/i18n/translation/en.json`                                                                                                 |
| 零外链   | 不引 CDN / Web Font / 统计脚本；`apps/site/build.mjs` 构建后自检外链、网络 API 与「英文页残留中文」，任一命中即失败                                                                    |
| 渐进增强 | FAQ 与文档用原生 `<details>`，无脚本时内容照样可读；演示区无脚本时四帧纵向展开                                                                                                         |

## 参与贡献

提交前跑通聚合门禁与格式检查：

```bash
pnpm check
pnpm format:check
```

其余约定（分层红线、持久化变更、权限冻结、文案流程）见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---
