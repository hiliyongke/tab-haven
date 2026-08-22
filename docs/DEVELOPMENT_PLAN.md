# TabHaven V1.0 开发计划（全新架构）

| 项目 | 内容 |
| --- | --- |
| 文档状态 | v1.0（2026-08-22） |
| 需求依据 | PRD.md 草案 v1.0（V1.0 范围 13 条 FR + 基线能力）；ARCHITECTURE.md 草案 v1.0 |
| 技术栈 | WXT 0.21 + React 19 + TS strict + zustand + zod + tldts + fuzzysort + i18next + Vitest |
| 状态 | **执行中**（Phase 0 进行中，后续每完成一个 Phase 更新状态） |

---

## 1. 开发原则（本计划与 Tabstead 的关系）

**行为继承，代码零复制。** TabHaven 是全新产品，与 Tabstead 的关系只存在于两个层面：

1. **需求层面**：PRD 附录 C 基线能力清单是**行为规格**（用户可见行为的承诺，如"同 URL 打开自动复用已有标签"），必须达成；
2. **代码层面**：**不迁移、不复制、不翻译 Tabstead 的任何实现**。领域模型、模块组织、算法结构、命名、并发模型全部重新设计。

**禁止事项**：
- 禁止把 Tabstead 的 src/*.js 函数按原名/原结构翻译为 TS；
- 禁止在代码注释中引用"移植自 Tabstead"（基线行为引用只出现在测试的 Given/When/Then 中作为需求来源）；
- 新设计遇到"同样的问题"时，重新建模解决，不以旧实现为蓝本。

**质量约束**：
- 测试先行：每个模块先写行为规格测试（Given/When/Then，来自 PRD 验收标准），再实现；
- 领域层（core）零 chrome/DOM 依赖，100% 可单测；
- 每个 Phase 结束时 `pnpm test / typecheck / lint / build` 全绿。

---

## 2. 重写范围盘点（受 Tabstead 实现影响，须重写）

| 现状文件 | 问题 | 处置 |
| --- | --- | --- |
| `src/core/url.ts` | 函数名与结构直接取自 Tabstead background.js | **重写**为 URL 规约模块（见 3.1） |
| `src/core/dupes.ts` | 六个函数逐一对应 Tabstead sidepanel/background 实现 | **重写**为索引与策略对象（见 3.2） |
| `src/core/grouping/site.ts` | siteIdentity 结构照搬 Tabstead | **重写**为 SiteResolver 管线（见 3.3） |
| `src/core/grouping/collect.ts` | collectWebsiteGroups 照搬 | **重写**为 SiteGrouping 聚合器（见 3.4） |
| `src/core/grouping/sections.ts` | 依赖旧 collect | **适配**新聚合器接口 |
| `src/entrypoints/background.ts` | pendingNewTabs/allowedDuplicateCreates/queueDuplicateCheck 整体照搬 Tabstead 并发模型 | **重写**为 ReuseCoordinator + AllowanceLedger + ReusePolicy（见 3.5） |
| `tests/core/url|dupes|collect|sections.test.ts` | 断言对照旧实现 | **重写**为行为规格测试 |
| `src/platform/tabs.ts`、`messages.ts`、`stores/tabStore.ts` | 自研（TabRecord 映射/zod 协议/zustand） | 保留，仅按新 core 接口适配 |
| `src/theme-init.ts` | 从 Tabstead 改写 | 逻辑为通用主题初始化模式，重写表述（见 3.6） |

---

## 3. 全新领域模型设计

### 3.1 URL 规约层（core/url）

**职责**：把"URL 字符串"规范为领域可判定的形态，与任何业务判断解耦。

```
core/url/
├── UrlSanitizer.ts   // URL → 规范化文本（协议允许集合、可比较形态）
├── UrlPolicy.ts      // URL 业务分类：可复用（Reusable）/ 空白起始页（BlankStart）/ 忽略（Ignored）
```

- `UrlSanitizer.normalize(rawUrl)`：解析 URL、判定协议（http/https 之外的返回忽略态）、归一化 hostname（小写/去 www/去尾点）——**产出规范化文本**；
- `UrlPolicy.classify(normalized)`：返回判别联合 `{ kind: 'reusable' } | { kind: 'blank-start' } | { kind: 'ignored' }`；
- 设计要点：可比较形态与业务分类分离（Tabstead 把两者混在 comparableUrl/isReusableUrl 三个函数里，且未归一化 hostname）。

### 3.2 重复标签索引（core/dup）

**职责**：以 URL 为键的只读索引 + 保留策略，输入标签快照，输出重复信息。

```
core/dup/
├── DuplicateIndex.ts  // 标签 → 按 URL 分组索引（构建一次，多次查询）
├── KeeperPolicy.ts    // 保留决策：{ keep: tab, dismissible: tab[] }
```

- `DuplicateIndex.build(tabs)`：O(n) 构建 `Map<url, TabRecord[]>`；
- `DuplicateIndex.groupCounts()`、`DuplicateIndex.groups()`、`DuplicateIndex.removable(keeperPolicy)`；
- `KeeperPolicy.select(group)`：纯策略值对象——按"激活 > 固定 > 位置靠前"序选出保留者，返回 `{ keeper, removable }`；
- 设计要点：索引与策略分离（Tabstead 是散函数，每次重新遍历）。

### 3.3 站点归组（core/site）

**职责**：URL → 归组键（SiteKey）的解析管线 + 聚合。

```
core/site/
├── SiteKey.ts        // 归组键值对象：{ key, label, registrableDomain, subdomain }
├── HostRules.ts      // 域名业务规则：本地/IP 带端口、托管公共后缀清单（PSL 盲区）
├── SiteResolver.ts   // 管线：UrlSanitizer 输出 → HostRules 匹配 → tldts → SiteKey
├── SiteGrouping.ts   // TabRecord[] → { groups: SiteGroup[], singles: TabRecord[] }
```

- `SiteResolver.resolve(sanitized)`：规则优先级——本地/IP（带端口键）> 托管清单（三级域）> tldts 注册域；
- `SiteGrouping.aggregate(tabs, threshold, excludedIds)`：达到阈值成组、未达阈值归 singles、排除集（手动移出）永不聚合；组按首标签位置排序；
- 设计要点：规则清单与解析器分离，threshold 与排除集为显式参数（Tabstead 硬编码阈值 2、排除集散落在调用方）。

### 3.4 标签同步服务（platform/sync）

**职责**：把 12 类浏览器标签事件统一为"快照刷新"信号，向状态层广播。

```
platform/sync/
├── TabEventsBus.ts   // 12 个事件源 → signal()
└── TabSyncService.ts // 挂起信号 + 批次刷新（节流）→ 查询 → 广播 TabSnapshot
```

- `TabSnapshot`：`{ tabs: TabRecord[], windowId: number | undefined, generation: number }`（代数递增，供订阅方判断新鲜度）；
- 刷新调度："signal 挂起 → 微任务批次内合并 → 窗口节流（40ms）→ 一次查询广播"，批次中再次 signal 则续批次；
- 设计要点：事件源、调度、查询三者分离成对象（Tabstead 是全局函数 + setTimeout 变量）。

### 3.5 复用协调引擎（platform/reuse，SW 内）

**职责**：新标签与已有标签同 URL 时，自动激活已有并关闭新的。

```
platform/reuse/
├── AllowanceLedger.ts  // 豁免账本：grant/consume + TTL 过期清理
├── ReusePolicy.ts      // 纯决策：候选排序（激活>固定>位置>id）、established 优先
├── ReuseCoordinator.ts // 协调者：标签生命周期跟踪 + 调度 + 执行
└── ReuseOutcome.ts     // 决策结果值对象：{ action: 'reuse' | 'keep', targetId? }
```

- `AllowanceLedger`：以 `windowId:url` 为键的授权令牌；`grant()` 发放、`consume()` 校验并扣减、过期令牌惰性清理；TTL 常量；
- `ReusePolicy.decide(newTab, candidates, trackingIds)`：纯函数，输出 `ReuseOutcome`；
- `ReuseCoordinator`：内部 `Map<tabId, Task>`；Task 状态机 `Queued → Scanning → Settled`；每个 Task 持有"最新快照"，调度器在空闲时处理最新快照（latest-wins 模式，微任务串行化）；
- 事件接入：onCreated 建档 → onUpdated 更新快照 → onRemoved 结算；
- 设计要点：与 Tabstead 的内存 Map + checking/needsCheck 标志循环完全不同的对象模型——职责拆分为账本/策略/协调者，调度用 latest-wins 快照覆盖。

### 3.6 主题初始化（src/theme-init.ts）

重新表述为独立初始化模块（与 React 渲染解耦）：同步读取主题偏好镜像 → 设置 documentElement 主题数据属性 → 监听系统主题变化（system 模式下）。逻辑本身是通用浏览器模式，重写结构与注释，不引用 Tabstead 表述。

---

## 4. 分阶段开发计划（V1.0）

> 每阶段产出 = 任务清单 + 行为规格测试 + 全绿门禁。完成勾选更新本表。

### Phase 0：领域模型与复用引擎重写（✅ 已完成 2026-08-22）
- [x] 3.1-3.3 全新 core 模型（UrlInspector、DuplicateIndex/KeeperPolicy、SiteKey/HostRules/SiteResolver/SiteGrouping）
- [x] 3.5 全新复用引擎（AllowanceLedger/ReusePolicy/ReuseCoordinator）
- [x] 3.4 TabSyncService 接入 tabStore（适配）
- [x] 行为规格测试重写（47 例，无 Tabstead 引用）
- [x] 门禁：test/typecheck/lint/build（标准+兼容）全绿

### Phase 1：标签视图与交互基座
- [ ] 视图模型（原生组 section / 站点 section / 未分组 section + 空态）
- [ ] 标签行操作：切换、关闭、静音、固定、n× 徽章、静音/拆分状态徽章
- [ ] 拆分视图指示与伙伴定位（只读）
- [ ] 门禁：手动验收清单 1（见 5.1）

### Phase 2：固定空间数据层
- [ ] DataRepository（zod schema 族 + 版本迁移管道 + 存储降级警示）
- [ ] 固定文件夹：增删改/折叠/排序/挂起条目/会话绑定/URL 全局唯一
- [ ] 永久固定图标：身份归一化/跨重启/与原生固定合并/中键语义
- [ ] 门禁：行为规格测试 + 手动验收清单 2

### Phase 3：搜索与键盘流（FR-D2.1/D2.2）
- [ ] SearchIndex/SearchService（fuzzysort + pinyin-pro prepare 索引）
- [ ] SearchOverlay（高亮/↑↓/Enter/Esc）
- [ ] commands 注册（focus-search/toggle-collapse/toggle-selection）+ 帮助面板
- [ ] 门禁：搜索 <100ms（150 标签）验收

### Phase 4：多选与批量（FR-D1.1）
- [ ] SelectionController（shift 连选/cmd 点选/全选）
- [ ] 批量操作条：关闭/固定/静音/移入文件夹/移入分组（全部可撤销）
- [ ] 门禁：行为规格测试

### Phase 5：多层撤销栈（FR-D8.1）
- [ ] UndoStack（操作记录制、栈深 10、持久化）
- [ ] RestoreEngine（restoreTabRecords 恢复管线 + 豁免联动）
- [ ] 门禁：行为规格测试（重启后撤销不丢）

### Phase 6：数据能力（FR-D9.1/D9.2）
- [ ] 导出/导入（JSON 版本化 + 往返无损 + URL 列表附件）
- [ ] Tabstead 数据迁移（幂等/单向/分区报告）
- [ ] 门禁：往返无损单测

### Phase 7：平台基座（FR-D10.x）
- [ ] i18n 全量文案（中英）+ 语言检测链 + 硬编码文案扫描
- [ ] 自制弹窗组件族（Prompt/Confirm，焦点陷阱 + 无障碍）
- [ ] 多形态（popup 快速切换器 / full 页）/ 兼容变体验证
- [ ] 隐私回归检查机制（权限/网络/存储 diff）
- [ ] 门禁：双变体构建全绿

### Phase 8：打磨与发布
- [ ] bundle 优化（tldts-core 减配、代码分割；目标 gz 收敛）
- [ ] 手动验收清单全量执行（docs/CHECKLIST-V1.0.md）
- [ ] 商店文案、隐私说明、README、CHANGELOG
- [ ] 发布门槛：PRD 4.2 的 V1.0 五项全过

---

## 5. 验收体系

### 5.1 手动验收清单（每阶段维护 docs/CHECKLIST-V1.0.md）

从 PRD 各 FR 的 Given/When/Then 验收标准导出，按阶段分批执行；UI 体验类不自动化。

### 5.2 自动门禁（CI 与本地）

`pnpm test`（行为规格）→ `pnpm typecheck` → `pnpm lint` → `pnpm build`（标准+兼容双变体）。

### 5.3 需求追溯

每完成一个 Phase，在 PRD FR→模块追溯表与 ARCHITECTURE.md 中同步标注实现状态。

---

## 6. 里程碑

| 里程碑 | 内容 | 完成条件 |
| --- | --- | --- |
| M0 | 全新架构重写 | Phase 0 门禁全绿 |
| M1 | 可用的标签视图 | Phase 1 完成 + 验收清单 1 |
| M2 | 固定空间可用 | Phase 2 完成 + 验收清单 2 |
| M3 | 效率工具（搜索/批量/撤销） | Phase 3-5 完成 |
| M4 | 数据与平台能力 | Phase 6-7 完成 |
| M5 | V1.0 发布候选 | Phase 8 完成，PRD 4.2 五项门槛全过 |
