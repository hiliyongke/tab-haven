# TabHaven（页港）V1.0 技术架构方案

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 草案 v1.0（2026-08-22） |
| 需求依据 | [PRD.md](./PRD.md) 草案 v1.0；本文档覆盖 V1.0 版本范围（13 条 FR + 附录 C 全部基线） |
| 技术路线 | TypeScript + WXT + React 19，权威库优先，杜绝自造轮子，性能体验第一 |
| 阅读指引 | 第 1-2 章为概要；第 5 章为核心模块关键详设；第 10 章为需求追溯表，评审时建议按该表核对覆盖度 |

---

## 1. 架构目标与约束

### 1.1 需求输入

V1.0 功能范围（PRD 4.1）：**附录 C 全部基线能力**（等价 P0）+ 以下 13 条 FR：

| FR | 名称 | 架构影响 |
| --- | --- | --- |
| FR-D1.1 | 多选与批量操作 | 选择状态域、批量操作管线、与撤销栈联动 |
| FR-D2.1 | 搜索增强 | 模糊搜索索引、键盘导航、命中高亮 |
| FR-D2.2 | 快捷键体系 | commands 权限、浏览器级快捷键注册 |
| FR-D3.1 | 多级域名归组 | 域名归组引擎重写（tldts）、层级偏好持久化 |
| FR-D3.3 | 分组折叠持久化 | 折叠状态存储 |
| FR-D4.1 | 固定文件夹排序 | 数据模型数组序即视图序 |
| FR-D8.1 | 多层撤销栈 | 撤销栈数据结构与持久化、恢复管线 |
| FR-D9.1 | JSON 导出/导入 | 导出格式设计、版本迁移、往返无损 |
| FR-D9.2 | Tabstead 无感迁移 | 旧数据读取与映射 |
| FR-D10.1 | 兼容与降级基座 | 多形态入口、特性检测、构建变体 |
| FR-D10.2 | i18n 中英双语 | 文案资源化、双语管线 |
| FR-D10.3 | 自制弹窗组件 | 弹窗/确认组件族 |
| FR-D10.5 | 隐私与权限最小化 | 权限冻结、隐私回归检查机制 |

### 1.2 宪法级原则的技术表达

| 原则 | 技术落地 |
| --- | --- |
| 数据不离设备 | 禁止引入任何网络请求库与远端资源；CSP 无 remote code（MV3 强制）；CI 中"网络请求 diff = 零"检查（10.2 节） |
| 降级而非拒绝 | 运行时能力检测 + 构建变体双保险（第 6 章） |
| 默认克制 | V1.0 无自动化能力，无此项；设置项默认值与基线一致 |
| 权限最小化 | manifest 权限冻结为附录 A 集合（sidePanel/tabs/tabGroups/storage/commands）；新增走 PRD 变更 |
| 可靠性承诺 | 所有用户数据写入走带校验与迁移的存储层（5.1 节）；坏数据隔离不扩散 |

### 1.3 性能指标（PRD 5.1，作为架构验收线）

- 150 标签 / 30 分组：事件刷新无可感知卡顿；搜索输入到结果 < 100ms；面板冷启动到可交互 < 500ms。

---

## 2. 总体架构

### 2.1 运行单元拓扑（MV3）

```
┌────────────────────────── 浏览器（Chromium 114+）──────────────────────────┐
│                                                                            │
│  [background Service Worker]          [sidepanel 主形态]                    │
│  ├─ 重复标签复用引擎（移植 Tabstead）      ├─ React Root <SidepanelApp/>       │
│  ├─ commands 快捷键分发                  ├─ 搜索覆盖层 / 多选操作条 / 弹窗宿主     │
│  └─ 消息协议端点 ◄─────── runtime ────────┤                                  │
│                                          └─ 主题初始化（内联，防闪烁）           │
│  [popup 降级形态]                        [pages/full 全页形态]                  │
│  ├─ React Root <QuickSwitcher/>          ├─ 设置 / 导入导出 / 迁移引导            │
│  └─ 搜索增强（复用同一引擎）               └─ 懒加载（不占主包）                    │
│                                                                            │
│  [chrome.storage.local] ←—— WXT storage + zod 校验层（单一数据通道）——→ 各单元  │
└────────────────────────────────────────────────────────────────────────┘
```

**与 Tabstead 的关键差异**：Tabstead 是"3 个平铺文件"；TabHaven 为多形态（sidepanel/popup/full）共享同一套 core 与状态层，每个 entrypoint 只挂不同的 React Root。

### 2.2 分层架构

```
┌───────────────────────────────────────────────┐
│ entrypoints/    sidepanel · popup · background · pages/full   ← 形态入口（薄）
├───────────────────────────────────────────────┤
│ ui/             React 组件（共享组件库 + 形态专属组件）            ← 展示层
├───────────────────────────────────────────────┤
│ stores/         zustand（tabStore / selectionStore / uiStore…） ← 状态层
├───────────────────────────────────────────────┤
│ platform/       chrome API 适配（tabs/storage/commands/messages/  ← 适配层
│                 capabilities 特性检测）—— 唯一允许触碰 chrome.* 的层
├───────────────────────────────────────────────┤
│ core/           纯领域逻辑，零 chrome / DOM 依赖，100% 可单测：    ← 领域层
│                 grouping · url · undo · dupes · schema · migrate · search
└───────────────────────────────────────────────┘
```

**依赖规则**（由 ESLint `import/no-restricted-paths` 强制）：`entrypoints → ui → stores → platform → core`，单向依赖；`core` 不依赖任何上层。

### 2.3 核心数据流（渲染管线，继承基线心智 + React 化）

```
chrome.tabs.* / chrome.tabGroups.* 事件（12 种）
   │  platform/tabs 事件聚合器
   ▼  40ms 防抖（继承基线验证值）
reconcile 管线：重查询 tabs+groups → 清理失效记录 → 合并原生固定 → 挂起条目转正 → 绑定维护
   │  单次 store.set（React 18+ 自动批处理）
   ▼
zustand tabStore（唯一标签真相源在浏览器，store 是镜像快照）
   │  selector 订阅（按切片订阅，避免全树重渲染）
   ▼
React 19 并发渲染（key = tab.id，节点稳定复用）
```

**视口保持语义**：Tabstead 需手动 settleViewport 保存/恢复 scrollTop；React 方案中滚动容器位于被替换子树之外，且列表项 key 稳定触发节点复用，滚动位置天然保持——基线的 preserveViewport 语义由架构自动满足（验收项写入第 8 章）。

---

## 3. 技术选型与依据

选型原则：每个领域选当前事实主流且活跃维护的权威库；库已覆盖的能力不自研。以下版本为 2026-08-22 核实（npm/GitHub 实测，非训练数据）。

| 领域 | 选择 | 版本 | 依据与替代的轮子 |
| --- | --- | --- | --- |
| 扩展框架 | **WXT** | 0.21.3 | 框架级：sidepanel 一等入口、`-b` 多浏览器 target、entrypoint 级 include/exclude（降级形态构建的核心机制）、HMR、Vitest 官方集成；10.4k stars 当天仍有提交。替代手写 manifest 生成与构建变体脚本。**注：0.x 语义版本，锁定 minor 升级**（风险见 11 章） |
| UI 框架 | **React** | 19.2 | 用户指定路线；19.2 的 `<Activity>` 组件用于折叠分组子树挂起（保留 DOM 状态，优化折叠/展开体验）|
| 构建 | Vite（WXT 内置） | 8.x | 以 WXT 锁定版本为准，不独立升级 |
| 语言 | **TypeScript** | 5.x | strict 模式 |
| 状态管理 | **zustand** | 5.0.14 | 轻量、selector 订阅保证性能、React 19 兼容确认；替代手写全局状态与事件总线 |
| 数据校验 | **zod** | 4.4.3 | 存储读取校验、消息协议校验、导入文件校验三处统一；替代 Tabstead 手写 normalizeXxx 防御函数族 |
| 域名/PSL | **tldts** | 7.x | Public Suffix List 权威实现：getDomain（eTLD+1）、getSubdomain；替代 Tabstead 手写**国家二级域逻辑**（.com.cn 等，实测正确）；**托管公共后缀清单（github.io 等 10 项）经实测不在 PSL 数据中，保留为业务胶水层**（见 5.2 节实测修正），PSL 数据随库更新 |
| 模糊搜索 | **fuzzysort** | 最新 | 亚毫秒级、prepare 预计算路径成熟；fzf-js 为 PoC 备选（开发期两者实测二选一，见 11 章 R3） |
| UI i18n | **react-i18next + i18next** | 17.x / 26.x | UI 文案标准方案；静态资源经 `import.meta.glob` 打包，无网络后端 |
| manifest i18n | **@wxt-dev/i18n** | 官方模块 | 与 `_locales` / 商店描述翻译体系兼容；与 react-i18next 分工（5.7 节） |
| 样式 | **Tailwind CSS** | 4.3.3 | v4 CSS-first（`@theme`），编译期零运行时；主题用 CSS 变量 + `data-theme`（继承基线防闪烁方案） |
| 单元测试 | **Vitest** | 4.x | WXT 官方测试集成；fake-browser（@webext-core/fake-browser）模拟 chrome API |
| Lint/格式化 | **ESLint 9 + Prettier + lint-staged + simple-git-hooks** | — | 事实主流组合；Biome 2 为观察项，不引入不确定性 |
| 包管理 | **pnpm** | — | WXT/CRXJS 社区默认 |

**不引入的库（刻意决策）**：

- **虚拟列表（react-window 等）**：150-300 标签规模 React key 稳定复用足够；预留为性能红线后的逃生舱（11 章 R4）
- **TanStack Query**：chrome.tabs 非远端资源，事件驱动镜像 + zustand 更直接
- ** immer**：zustand v5 + 不可变更新模式足够，减少一层抽象
- **Redux Toolkit / RTK Query**：体量与场景不匹配

---

## 4. 工程结构

```
tabhaven/
├── wxt.config.ts               # 入口注册、manifest 钩子（变体裁剪）、模块加载
├── package.json / tsconfig.json / eslint.config.js / vitest.config.ts
├── public/icons/
├── src/
│   ├── entrypoints/            # 形态入口（薄壳）
│   │   ├── background.ts       # SW：复用引擎 + commands 分发 + 消息端点
│   │   ├── sidepanel/          # index.html + main.tsx → <SidepanelApp/>
│   │   ├── popup/              # index.html + main.tsx → <QuickSwitcherApp/>
│   │   └── pages/full/         # 设置/导入导出/迁移引导（懒加载全页）
│   ├── core/                   # 纯领域逻辑（零 chrome/DOM 依赖，单测主战场）
│   │   ├── grouping/           # tldts 封装、归组键计算、层级偏好合并
│   │   ├── url/                # savableUrl、comparableUrl（V1.2 归一化预留接口）
│   │   ├── undo/               # 撤销栈数据结构、栈深淘汰、恢复计划生成
│   │   ├── dupes/              # 重复组计算、keeper 选择策略
│   │   ├── search/             # fuzzysort 封装、索引构建、排序策略
│   │   ├── schema/             # zod schema 族 + 版本迁移管道 + 导出格式定义
│   │   └── migrate/            # Tabstead 数据 → TabHaven 数据映射
│   ├── platform/               # chrome 适配层（唯一触碰 chrome.* 的层）
│   │   ├── tabs.ts             # 事件聚合器（40ms 防抖）、查询、reconcile 触发
│   │   ├── storage/            # WXT storage 封装 + zod 校验读写 + 防御性降级
│   │   ├── commands.ts         # 浏览器级快捷键注册与分发
│   │   ├── messages.ts         # 类型安全消息协议（zod + runtime.sendMessage）
│   │   └── capabilities.ts     # sidePanel/storage 可用性检测（决定形态）
│   ├── stores/                 # zustand store 族
│   │   ├── tabStore.ts         # tabs/groups 镜像 + reconcile 结果 + 派生分组
│   │   ├── selectionStore.ts   # 多选状态（FR-D1.1）
│   │   ├── searchStore.ts      # 搜索状态与结果
│   │   ├── undoStore.ts        # 撤销栈镜像 + undo 执行
│   │   ├── dataStore.ts        # 固定文件夹/永久固定/设置（存储层订阅）
│   │   └── uiStore.ts          # 主题/菜单/弹窗/折叠等界面态
│   ├── ui/                     # React 组件库
│   │   ├── shell/              # ThemeShell、StatusToast（含撤销按钮）
│   │   ├── tabs/               # TabRow、TabList、各 Section、SelectionBar
│   │   ├── fixed/              # PinnedStrip、FolderList、FolderRow、SavedItemRow
│   │   ├── search/             # SearchOverlay（键盘导航、高亮）
│   │   ├── menus/              # ContextMenuHost（5 类菜单，键盘可达）
│   │   ├── dialog/             # 自制弹窗族（FR-D10.3）：PromptDialog/ConfirmDialog
│   │   └── common/             # Icon、Badge、EmptyState
│   ├── i18n/
│   │   ├── index.ts            # i18next 初始化（语言检测 + 设置覆盖）
│   │   └── locales/{zh-CN,en}/
│   ├── styles/                 # theme.css（CSS 变量 + data-theme）、tailwind 入口
│   └── theme-init.ts           # 内联进各 html head（继承基线防闪烁）
└── tests/                      # core 单测（与 src/core 镜像）+ platform fake-browser 测试
```

---

## 5. 核心模块关键详设

### 5.1 存储层（platform/storage + core/schema）

**Key 命名空间**：统一 `tabhaven.<域>.v<n>`，与 Tabstead 原 key（`fixedFoldersV1` 等）物理隔离——这是 FR-D9.2"迁移不动原数据"的前提。

| Key | 内容 | 版本 |
| --- | --- | --- |
| `tabhaven.fixed-folders.v1` | 固定文件夹数组（含条目数组序 = D4.1 排序，文件夹数组序 = 视图序） | v1 |
| `tabhaven.persistent-pins.v1` | 永久固定图标（身份归一化规则继承基线） | v1 |
| `tabhaven.undo-stack.v1` | 撤销栈（FR-D8.1，见 5.4） | v1 |
| `tabhaven.site-collapse.v1` | 网站分组折叠状态（FR-D3.3：Set 序列化） | v1 |
| `tabhaven.group-level.v1` | 分组归组层级覆盖（FR-D3.1：归组键 → 层级） | v1 |
| `tabhaven.settings.v1` | 主题、语言覆盖、聚合阈值（V1.2 预留字段）等 | v1 |
| `tabhaven.migrated.v1` | 迁移完成标记（FR-D9.2 幂等） | v1 |

**读写管线**（每 key 走同一路径，替代 Tabstead 每 key 手写 load/save/normalize 三件套）：

```
写入：zod schema.parse → WXT storage.set
读取：WXT storage.get → zod safeParse → 成功：返回数据
                                    └ 失败：隔离坏数据（写入 quarantine key 供诊断）
                                             + 返回默认值/上次已知好值
跨版本：schema 定义 current + migrations 链（v1→v2→…逐级），读取时按数据内嵌
        version 字段自动前滚——导出文件复用同一管道（FR-D9.1 往返无损的实现基础）
```

**降级策略**：WXT storage 底层即 chrome.storage.local；chrome.storage 不可用时（storage 权限被策略禁用等极端场景）防御性降级为内存态 + 界面警示条（比 Tabstead 的 localStorage 双写降级简化：MV3 侧边栏环境中 chrome.storage 可用性极高，双层双写的一致性成本高于收益，架构决策为"单通道 + 防御警示"）。

### 5.2 领域层：域名归组引擎（core/grouping，FR-D3.1）

```ts
// 归一化（继承基线语义，PSL 部分交给 tldts）
siteIdentity(url): { key, label, registrableDomain, subdomain } | null
// 规则（按序）：
//  1. 仅 http/https 参与；hostname 小写、去 www 前缀、去尾点
//  2. localhost / .localhost / IP（v4/v6）：带端口整体为 key（继承基线）
//  3. 托管公共后缀胶水清单：最后两段命中 Tabstead 基线 10 项清单
//     （blogspot.com/firebaseapp.com/github.io/netlify.app/notion.site/
//      pages.dev/surge.sh/vercel.app/web.app/wordpress.com）时取三级域。
//     【实测修正 2026-08-22】tldts 7.4 的 PSL 数据不包含这些"事实公共后缀"，
//      基线手写清单场景不能由 tldts 单独覆盖，需此业务胶水层兜底；
//      国家复合后缀（.com.cn/.co.uk）经实测由 tldts 正确返回。
//  4. 其余：tldts.getDomain(hostname) 取注册域（eTLD+1），PSL 权威覆盖
//  5. 子域保留于 subdomain 字段（分组标题下钻展示用）

// 归组层级
resolveGroupKey(site, overrides): string
// 默认 = 注册域（或托管域三级）；overrides（group-level 存储）可将单组
// 收紧为精确子域。层级覆盖只影响展示归组，不影响拖放校验语义（同源约束继承基线）
```

**与基线的兼容性红线**：`localhost:3000` 与 `localhost:8080` 必须仍为两组（tldts 对 localhost 返回 null，走第 2 条规则胶水路径）；托管域行为不回归（依赖第 3 条胶水清单，清单以 Tabstead 基线为准并随基线演进维护）。单测固定为契约用例（第 8 章）。

### 5.3 领域层：搜索（core/search，FR-D2.1）

- **索引**：TabRow 挂载时对 `title + url` 预计算 fuzzysort prepare 结果（O(1) 挂载成本，查询零准备）；索引随 store 镜像更新失效重建。
- **查询**：fuzzysort 单字段多目标（title 优先加权 > url）→ 结果按"当前激活 > 最近激活 > 其余"二级排序 → 截断 50 条。
- **拼音/首字母**：中文标题的拼音索引由 `pinyin-pro` 预计算（该库为拼音领域事实主流）；英文标题天然支持首字母子序列匹配。
- **键盘协议**：↑/↓ 循环、Enter 切换并关闭、Esc 退出（焦点返回列表）；全部在 SearchOverlay 内闭环，不依赖浏览器默认行为。

### 5.4 撤销栈（core/undo + stores/undoStore，FR-D8.1）

**数据结构**（操作记录制而非状态快照制——快照制在标签外部真相源上是错误的：撤销只能"补偿"不能"回滚"浏览器状态）：

```ts
interface UndoBatch {
  id: string;
  kind: 'close' | 'batch-close' | 'move-to-folder' | 'unpin' | …;  // V1.0 覆盖关闭/批量/移动
  createdAt: number;
  entries: TabRecord[];      // 每条 = {url, index, pinned, muted, groupId, groupName}
}                            // groupName 新增：原组已删时按名重建（与 FR-D5.1 对齐，
                             // V1.0 即采用，为 V1.1 快照复用同一恢复管线）
栈深 10，FIFO 淘汰；持久化到 tabhaven.undo-stack.v1（重启不丢）。
```

**恢复管线**：`undo()` → 对 batch 内 entries 按 index 升序：发豁免消息（继承基线协议）→ tabs.create（恢复五元组）→ 尝试按 groupId/groupName 回组 → 完成后 toast 报数。恢复与快照恢复（V1.1）共用 `restoreTabRecords()` 单一入口——**V1.0 打好该地基是"快照不进 V1.0"决策的技术兑现**。

### 5.5 状态管理（stores）

| Store | 职责 | 关键切片 |
| --- | --- | --- |
| tabStore | tabs/groups 镜像 + reconcile 输出 + 派生分组视图模型 | `tabs`、`sections`（useShallow 订阅）、`activeId` |
| selectionStore | FR-D1.1：`Set<tabId>` + range 锚点 + 批量动作执行 | `selectedIds`、`anchorId` |
| searchStore | 查询词、结果、高亮选中索引 | — |
| dataStore | 存储 key 的内存镜像（WXT storage watch 驱动，多形态天然同步） | folders/pins/settings |
| uiStore | 主题解析、菜单/弹窗开关、折叠态（非持久部分） | — |

**性能策略**：行级组件以 `tabId` selector 精确订阅自身切片；sections 列表用 `useShallow` 比较引用；批量操作产生的连续更新由 React 自动批处理吸收。**150 标签红线内不虚拟化**（性能预算实测点，见 11 章 R4）。

### 5.6 消息协议与快捷键（platform）

**协议**（类型安全薄封装：`defineMessage(schema)` 生成 send/handle 对，约 50 行，无轮子可引——chrome.runtime 消息层无可信第三方抽象）：

| 消息 | 方向 | 语义 |
| --- | --- | --- |
| `allow-duplicate-once` | UI → SW | 继承基线：豁免下一次同 URL 创建（校验 Integer + 可复用 URL） |
| `duplicate-reused` | SW → UI | 继承基线：复用发生通知（toast） |
| `open-sidepanel` | SW/popup → SW | commands 分发：sidePanel.open 兜底 |

**commands 注册**（FR-D2.2，V1.0 四条，浏览器级上限内）：

| 命令 | 默认键 | 动作 |
| --- | --- | --- |
| `_execute_action` | 浏览器默认 | 工具栏图标行为（sidePanel 形态开面板；降级形态开 popup） |
| `focus-search` | Ctrl/Cmd+K（面板内接管） | 聚焦搜索（等价基线 ⌘K，向上兼容） |
| `toggle-collapse` | Ctrl/Cmd+. | 折叠/展开当前激活标签所在分组 |
| `toggle-selection` | Ctrl/Cmd+L | 进入/退出选择模式（FR-D1.1） |

面板内快捷键（j/k 导航等）不入 commands（浏览器级配额留给全局动作），在 uiStore 快捷键表内实现并在帮助面板展示真实生效键位。

### 5.7 i18n 双轨（FR-D10.2）

| 轨道 | 工具 | 覆盖 |
| --- | --- | --- |
| UI 文案 | react-i18next，`locales/{zh-CN,en}/*.json`，`import.meta.glob` 静态打包 | 界面全部字符串、日期时间格式（Intl） |
| manifest/商店文案 | @wxt-dev/i18n + `_locales/*/messages.json` | name/description/权限说明 |

语言决策链：`settings.language`（用户覆盖）→ `chrome.i18n.getUILanguage()`（跟随浏览器）→ zh-CN 兜底。切换即时生效（i18next.changeLanguage，无重启）。CI 增加"硬编码文案扫描"步骤（eslint 规则禁裸中文 JSX 文本）。

### 5.8 自制弹窗（ui/dialog，FR-D10.3）

组件族：`PromptDialog`（文本输入，替代 window.prompt：新建/重命名文件夹）、`ConfirmDialog`（危险操作分级：danger 样式 + 二次确认文案）。行为契约：打开聚焦首项、Enter 确认、Esc 取消、Tab 循环、aria-modal + 焦点陷阱（radix 级行为自实现，不引 UI 大库——**唯一刻意不引权威库处：两个弹窗引入 Radix 成本倒挂**，以 ~150 行自实现 + 无障碍单测覆盖）。

### 5.9 Tabstead 迁移（core/migrate，FR-D9.2）

```
触发：sidepanel 首次启动 → capabilities 检测 + tabhaven.migrated.v1 标记未置
读取（只读，绝不写回）：fixedFoldersV1、persistentPinsV1、themePreferenceModeV2
映射：旧 schema（zod 宽松解析）→ 新 schema 逐字段映射 → 校验通过写新 key → 置迁移标记
失败语义：任一分区解析失败仅跳过该分区并报告，不阻塞其余
```

幂等（标记位）、单向（不动旧数据）、可重入（中断后下次继续）。

---

## 6. 多形态与构建变体（FR-D10.1）

### 6.1 形态路由（运行时）

```ts
// platform/capabilities.ts
hasSidePanel = typeof chrome.sidePanel !== 'undefined'
hasStorage   = Boolean(chrome.storage?.local)
```

- **支持 sidePanel**（Chrome 114+/Edge）：action 点击 → `sidePanel.setPanelBehavior({openPanelOnActionClick: true})`（继承基线）；popup 入口仍构建作为"快速切换器"加分项。**实现注（2026-08-22 脚手架实测）**：WXT 检测到 popup.html 会自动注入 `action.default_popup`，与 setPanelBehavior 的点击行为不冲突（Chrome 平台行为：openPanelOnActionClick 时点击开侧栏，右键图标仍可开 popup），故保留 default_popup 作为快速切换器入口。
- **不支持**（Opera/Vivaldi/未知 Chromium）：action → popup（QuickSwitcher，FR-D2.1 的天然载体）；重操作（设置/导入导出/迁移）跳转 `pages/full`（tabs.create 打开扩展页）。
- 形态能力差异在 UI 上显式引导（"此功能请前往完整页面"），不静默失效（PRD 验收项）。

### 6.2 构建变体（构建期，WXT 原生机制）

| 变体 | WXT 配置 | manifest 差异 |
| --- | --- | --- |
| 标准版（Chrome/Edge/Brave） | `wxt build`（默认） | 含 `side_panel` + `permissions: [sidePanel]`（WXT 检测 sidepanel 入口自动生成） |
| 兼容版（旧内核/其他 Chromium） | `TABHAVEN_VARIANT=compat wxt build` | 经 `build:manifestGenerated` hook 确定性剥离 `side_panel` 与 `sidePanel` 权限（**实测修正 2026-08-22**：manifest 配置函数会被 WXT 自动检测合并覆盖，剥离必须放 hook 做后处理）；action 绑定 default_popup |

**V1.0 只发布标准版**；兼容版随 V2.0 Opera/Vivaldi 支持评估一起交付，但变体管道 V1.0 建成（CI 产出两个 zip 保证不腐化）。兼容变体中 sidepanel 产物文件仍会构建输出但不被 manifest 引用（无害的体积代价，接受）。

---

## 7. 导出格式与数据 Schema 总表（FR-D9.1）

导出文件为单一 JSON（内嵌 `formatVersion`），复用 5.1 迁移管道实现跨版本导入：

```jsonc
{
  "format": "tabhaven.export",
  "formatVersion": 1,
  "exportedAt": "2026-08-22T00:00:00.000Z",
  "fixedFolders": [ /* schema 同存储 key */ ],
  "persistentPins": [ /* 同上 */ ],
  "siteCollapse": { /* FR-D3.3 */ },
  "groupLevelOverrides": { /* FR-D3.1 */ },
  "settings": { /* 主题/语言/阈值 */ }
}
```

- **不含**：撤销栈（会话性）、标签镜像（浏览器真相源）。导入模式：合并（按身份去重并入）/ 覆盖（二次确认全量替换）。
- 导出同时附带纯文本 URL 列表（PRD 验收项）。
- 往返无损的验收 = 导出→空环境覆盖导入→再导出 → 逐 key deep-equal（单测固定）。

---

## 8. 测试方案（Vitest 4 + fake-browser）

| 层 | 范围 | 方式 |
| --- | --- | --- |
| core 单测（主战场） | grouping（**契约用例：localhost 分端口、github.io 三级、.com.cn 三级不回归**）、search（中英文/拼音/键盘协议模拟）、undo（栈深淘汰/恢复计划/幂等）、dupes（keeper 策略）、schema（迁移链/坏数据隔离/导出往返）、migrate（Tabstead 样例数据三组快照） | 纯函数，无 mock |
| platform 测试 | storage 读写管线、消息协议、tabs 事件聚合（防抖时序） | @webext-core/fake-browser |
| stores 集成 | reconcile 管线（事件序列 → store 状态快照） | fake-browser + store 断言 |
| UI | 弹窗焦点陷阱、菜单键盘导航 | @testing-library/react（仅无障碍契约级，不做全量 UI 测试） |
| 验收 | PRD 每条 FR 的 GWT 清单 | 导出为 `docs/CHECKLIST-V1.0.md` 手动执行（延续基线"手动验证为主"传统，UI 体验项不由自动化背书） |

**CI 门禁**：lint → tsc --noEmit → vitest run → wxt build（标准版 + 兼容版）→ zip 产物；任何一步红即阻塞合并。

---

## 9. 开发与构建命令

```bash
pnpm install          # 安装
pnpm dev              # WXT dev（Chrome，HMR，自动拉起浏览器加载扩展）
pnpm dev:edge         # Edge target
pnpm build            # 生产构建（标准版）→ .output/chrome-mv3
pnpm build:compat     # 兼容变体 → .output/compat
pnpm test             # vitest run
pnpm test:watch       # 开发期
pnpm lint / pnpm format
```

---

## 10. FR → 模块追溯表（评审核对用）

| FR | 落点模块 | 关键依赖库 |
| --- | --- | --- |
| 基线 1（列表/切换/静音等） | ui/tabs + tabStore + platform/tabs | React |
| 基线 2-3（固定图标/固定文件夹） | ui/fixed + dataStore + core/schema | zustand/zod |
| 基线 4（网站聚合） | core/grouping + tabStore | **tldts**（重写） |
| 基线 5（原生组映射） | tabStore sections + ui/menus | — |
| 基线 6-8（复用/豁免/清理） | entrypoints/background（算法移植）+ core/dupes | — |
| 基线 9（搜索，被升级） | core/search + ui/search | **fuzzysort + pinyin-pro** |
| 基线 10（拆分视图指示） | tabStore 派生 + ui/tabs | — |
| 基线 11（主题三态） | theme-init + styles/theme.css + uiStore | Tailwind v4 |
| 基线 12（存储/撤销，被升级） | platform/storage + core/undo | **WXT storage + zod** |
| FR-D1.1 多选批量 | selectionStore + ui/tabs/SelectionBar | zustand |
| FR-D2.1 搜索增强 | core/search + ui/search | fuzzysort + pinyin-pro |
| FR-D2.2 快捷键 | platform/commands + 帮助面板 | — |
| FR-D3.1 多级域名归组 | core/grouping + group-level 存储 | **tldts** |
| FR-D3.3 折叠持久化 | site-collapse 存储 + tabStore | — |
| FR-D4.1 文件夹排序 | dataStore（数组序）+ ui/fixed 拖放 | — |
| FR-D8.1 多层撤销 | core/undo + undoStore + restoreTabRecords() | — |
| FR-D9.1 导出导入 | core/schema 导出格式 + pages/full | zod |
| FR-D9.2 迁移 | core/migrate + 首启流程 | zod |
| FR-D10.1 兼容基座 | platform/capabilities + WXT 变体 | **WXT** |
| FR-D10.2 i18n | i18n/ + @wxt-dev/i18n | **i18next** |
| FR-D10.3 弹窗 | ui/dialog | 自实现（理由见 5.8） |
| FR-D10.5 隐私红线 | manifest 权限冻结 + CI diff 检查 | — |

---

## 11. 风险与对策

| # | 风险 | 对策 |
| --- | --- | --- |
| R1 | **WXT 0.x 语义版本可能 breaking** | 锁定 minor（`~0.21`）；升级走独立 PR + 全量回归；WXT 仅使用其稳定面（entrypoints/manifest/storage/i18n 模块），框架逃逸成本低（目录即标准 WXT 结构，最坏迁 CRXJS 或裸 Vite 多入口，core/stores/ui 三层完全可迁移） |
| R2 | React 首包体积影响 sidepanel 冷启动（<500ms 红线） | sidepanel/popup 为同步入口且共享 chunk；full 页懒加载；实测不过线则收紧依赖并启用预加载；React 19 + Vite 分包下预算充足（预估 gz < 60KB） |
| R3 | fuzzysort vs fzf-js 无权威基准 | 开发第 1 周 PoC：1.5 万条标题+URL 实测 p95；败者移除，胜者进锁文件 |
| R4 | 300+ 标签极端场景行级渲染压力 | key 稳定复用为主；性能红线触发时引入 react-window（已在"不引入清单"预留逃生舱） |
| R5 | tldts 内嵌 PSL 数据体积（数十 KB） | 仅 background 与 sidepanel 使用（tree-shake 至两入口）；PSL 更新随依赖升级，纳入依赖更新例行项 |
| R6 | 多形态共享 store 的状态漂移 | 存储数据以 WXT storage watch 为唯一同步源（dataStore 不做本地写后即忘）；标签镜像每形态独立 reconcile（真相在浏览器，无漂移面） |
| R7 | commands 快捷键与浏览器/站点冲突 | 默认键位保守；帮助面板直链浏览器快捷键设置页（PRD 验收项）；冲突时浏览器侧用户可改，帮助面板同步展示 |

---

## 12. 从 Tabstead 的继承 / 替代 / 重写清单

| 处置 | 内容 |
| --- | --- |
| **算法移植**（改写 TS，语义不变） | background 复用引擎全套（串行检查队列、TTL 豁免、keeper 偏好 active>pinned>最早、无痕排除）；拖放校验矩阵；挂起条目与绑定 reconcile 流程；主题三态决策逻辑 |
| **被权威库替代**（删除手写） | 国家复合后缀逻辑 → tldts；托管公共后缀清单保留为胶水层（实测修正，见 5.2）；normalizeXxx 族 → zod；手写 DOM 模板与全量重建 → React；手写 CSS 主题变量体系 → Tailwind @theme + CSS 变量；手写 storage 三件套 → WXT storage |
| **重写**（React/分层化） | 渲染管线（settleViewport 语义由架构自动满足）；存储层（单通道+校验+迁移管道）；弹窗（D10.3）；i18n（资源化双语） |
| **全新** | 多选批量、多层撤销栈及持久化、恢复管线 restoreTabRecords()、导出导入、Tabstead 迁移、commands 快捷键、搜索增强、多形态与构建变体 |
| **废弃**（明确不做） | localStorage 双写降级（以防御警示替代，见 5.1）；window.prompt/confirm 全部调用点 |

---

*（全文完。变更记录：草案 v1.0，2026-08-22 首次成文；待 V1.0 开发启动评审后修订为定稿。）*
