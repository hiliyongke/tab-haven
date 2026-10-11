# Tabs v1.0 第一版验收评审报告

> 评审日期：2026-10-11 · 评审对象：`tabs` v1.0（未封板、未发布）· 评审方式：功能验收 / 代码质量 / 产品设计 / 安全隐私 四路并行专家评审 + 门禁实测复核
> **状态（2026-10-11 后续处理）**：本文是评审当时的快照。其中第 1、2、4 项已按建议处理（`EXPORT_FILE_VERSION` 归 1 并删兼容意图注释、兼容变体管道删除、空目录删除）；第 3 项（popup）保留待 V2.0 决策；第 5 项（迁移器）待拍板。下方表格保留原文并附处理状态。
> 评审红线：分层架构（core ← platform ← stores/ui/entrypoints）、零出站网络、权限冻结、校验唯 schema、文案双语；**第一版不得包含任何版本兼容 / 数据迁移类能力**

---

## 一、验收结论

### **有条件通过（Conditional Pass）**

**理由**：功能完整性与工程质量达标，无阻断级缺陷；但存在 **3 项上线前必须处理** 的问题（1 项安全纵深缺口、1 项撤销安全网漏洞、1 项架构越层），以及 **1 类范围问题**（v1 内仍残留版本兼容 / 迁移 / 兼容变体代码，违反"第一版不做兼容"的约束）—— **该类问题的 5 项中已有 3 项处理完毕**（版本归 1、兼容变体管道删除、空目录删除），余 2 项待拍板，见第五节表格「处理状态」列。

完成下表「必改项」（合计约 **4.3 人日**）后即可发布；其余项排入 v1.1。

| 必改项                                      | 类别        | 工作量   |
| ------------------------------------------- | ----------- | -------- |
| A-01 备份导入 `url` 字段缺 scheme 白名单    | 安全        | 0.5 人日 |
| A-02 「快速整理/重排」一键不可撤销          | 产品        | 1.0 人日 |
| A-03 `settingsSlice` 直连 `browser.storage` | 架构        | 0.5 人日 |
| A-04 清理 v1 范围外的兼容/迁移代码          | 范围        | 1.5 人日 |
| A-05 跨窗口撤销/重做丢失分组名              | 功能        | 0.8 人日 |
| A-06 导出 schema `version` 默认值与注释矛盾 | 范围/正确性 | 0.3 人日 |

### 门禁实测（本轮真实执行）

| 项                                | 结果                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm typecheck`                  | ✅ 通过（exit 0）                                                                         |
| `pnpm lint`（`--max-warnings 0`） | ✅ 通过（0 warning）                                                                      |
| `pnpm test`                       | ✅ **109 测试文件 / 1063 用例全部通过**                                                   |
| `pnpm check:privacy`              | ✅ 通过（源码 159 文件 + 产物 11 文件，网络通道调用 0）                                   |
| `pnpm check:i18n`                 | ✅ 通过                                                                                   |
| 分层覆盖率                        | core **100%** · platform **87.1%** · stores **64.9%** · 全量 74.24%（行）/ 76.13%（语句） |

---

## 二、三维评估

### 2.1 功能验收 —— **通过（B+）**

PRD 的 FR-1…FR-12 共 77 条子需求逐条追到代码落点，**未发现"只有按钮没有实现"的空壳功能**。8 条核心端到端链路（重复清理→撤销、撤销栈/重做、快照保存/恢复 diff/导入、自动休眠+白名单+唤醒、导入事务回滚、三路搜索、dnd 拖拽、文件夹全能力、跨窗口/角标/右键/omnibox）均核实为四层贯通。

| 能力域                  | 判定 | 能力域                        | 判定                         |
| ----------------------- | ---- | ----------------------------- | ---------------------------- |
| 标签视图与分区          | 完整 | 重复治理与复用引擎            | 完整                         |
| 固定空间（文件夹+磁贴） | 完整 | 导入导出与同步镜像            | 完整                         |
| 搜索与检索              | 完整 | 快捷入口（右键/omnibox/角标） | 完整                         |
| 撤销安全网（含 Redo）   | 完整 | 设置与个性化                  | 部分（FR-11.7 搜索覆盖不全） |
| 快照/归档/工作空间      | 完整 | 引导与信任面板                | 完整                         |
| 休眠与资源              | 完整 | Backlog BR-01…18              | 8 已落地 / 6 未排期          |

**已做对且应保留的关键设计**（抽查核实，均有 `file:line`）：

- 撤销栈纪律：`undoStore.ts:356-436` 恢复成功才出栈、失败项回填栈顶、FIFO 淘汰并回执告知、`undoInFlight` + 写盘串行锁防止并发击穿。
- 快照恢复为**纯加法** + diff 三分类口径与 `missingTabsOf` 严格镜像（`core/snapshot/snapshotDiff.ts:5-14,49-84`）——预览不失信。
- 备份导入为事务：5 分区串行写 + 磁盘基线回滚 + 回滚失败如实告知（`stores/data/transferSlice.ts:80-94,174-190`），且**同步开关不随备份迁移**（`:110-116`），杜绝"导入即上云"。
- 「无操作静默空跑」禁令被写成规格：`App.tsx:637-641,704-707,731-735` 每个批量动作无候选时都给提示而非静默 return。
- 归档失败不关窗（`snapshotStore.ts:204-212`），留档抛错即中止。

### 2.2 代码质量 —— **通过（A-）**

| 维度     | 评分 | 依据                                                                                               |
| -------- | ---- | -------------------------------------------------------------------------------------------------- |
| 架构合规 | A-   | core / ui 零越层；仅 `settingsSlice` 一处实质违规                                                  |
| 类型安全 | A    | 全库零 `as any` / `@ts-ignore` / `innerHTML` / `eval`；6 处 `as unknown as` 均在 platform 适配边界 |
| 性能     | B+   | `SearchEngine` 实例全在 `useMemo` 内；`VirtualRowList` 已接入并有测试守卫；事件节流到位            |
| 健壮性   | B+   | 零空 `catch`；坏数据隔离到 `tabs.quarantine`（`DataRepository.ts:130-141`）                        |
| 可维护性 | B    | 5 个超长文件；hostname 归一化残留 3 处内联副本                                                     |
| 测试覆盖 | A-   | 测试与 `src/` 严格镜像 + 分层 ratchet；core 100% 行覆盖                                            |

**已做对**：core 层纯净度满分（grep `chrome.`/`browser.`/`document.`/`from 'react'` 命中全是注释，如 `core/tab-types.ts:2-4` 主动声明边界）；覆盖率 ratchet 分层且带实测注释（`vitest.config.ts:68-91`），不是空阈值；**不存在任何版本迁移层**（`migrat|legacy|schemaVersion` grep 零命中）。

### 2.3 产品设计 —— **有条件通过（C+/B-）**

产品主线（「可逆性」而非「组织」）定位准确，信任可自证、空态即引导、条件出现式动作入口三项是真正的差异化资产。但 **v1 范围失控** 与 **术语混乱** 是两块短板。

| 维度       | 评分  | 一句话                                                  |
| ---------- | ----- | ------------------------------------------------------- |
| 需求匹配度 | B     | 实现对齐 PRD 主线，但 PRD 已滞后代码两个版本            |
| 信息架构   | C     | 首屏最多 12 段堆叠；「固定」一词承载 5 种语义           |
| 交互一致性 | C     | 破坏性操作确认不对称；跨平台键位文案两套写法            |
| 可发现性   | B     | 三层引导做得到位，时间线搜索与洞察仍偏弱                |
| 范围控制   | **D** | 迁移器、备份版本机、兼容变体、46 个设置项，全挤在首发版 |

---

## 三、必改项（上线前）

### A-01 · [阻断] 备份导入的 `url` 字段无 scheme 白名单

- **证据**：`src/core/schema/models.ts:57`（`FixedFolderItemSchema.url`）、`:78`（`PersistentPinSchema.url`）、`:256`、`:295` 均为 `z.string()`；而导入专用 schema 只替换了 `favIconUrl`（`models.ts:400-414`），`url` 未收紧。对照 `models.ts:391` 图标已有 `data:image/|chrome://|chrome-extension://` 白名单。
- **风险**：恶意备份可注入 `javascript:` / `data:text/html` / `file:` / `chrome://extensions` 条目，落盘后成为一等公民数据。当前主要靠浏览器兜底阻止导航（不可直接利用），但这是单点依赖宿主行为的防御；一旦将来渲染路径出现 `<a href={url}>` 即升级为真实 XSS。
- **改法**：新增 `ImportUrlSchema`（`z.string().transform()`，仅放行 `http:`/`https:`，越界归一为 `undefined`），在 `ImportFixedFolderItemSchema` / `ImportPersistentPinSchema` / `ImportSnapshotTabSchema` 中替换 `url`。**只在导入专用 schema 上收紧**，避免读盘误伤存量数据。
- **验收**：新增单测「备份含 `javascript:alert(1)` 条目 → 导入后该条目 url 为空」；`pnpm test` + `pnpm check:privacy` 双绿。
- **工作量**：0.5 人日

### A-02 · [阻断] 「快速整理/重排」常驻一键且明确不可撤销

- **证据**：`src/entrypoints/sidepanel/FooterToolbar.tsx:121-129`（常驻底栏按钮）；文案 `footer.quickRegroupHint`（`src/i18n/locales/zh-CN/translation.json:51`）原文含「重排不进撤销栈，不可撤销」；实现见 `App.tsx:772-803`。
- **风险**：一键打散全部手工分组并按当前模式重组，无预览、无确认、无回退 —— 与本产品「一切关闭都可反悔」的核心承诺**正面冲突**，是安全网上唯一的洞。
- **改法**（建议后者）：① 从常驻底栏降级到命令面板/分区头二级入口（0.2 人日）；② 保留一键，但重排前自动写一份 `auto` 快照作回退点，回执给「已重排 N 组 · 现场已存快照 · 查看」。
- **验收**：重排后在撤销历史面板或快照面板可找回重排前现场；回执可点击直达。
- **工作量**：1.0 人日（方案②）

### A-03 · [P1] `stores` 层直连 `browser.storage`，绕过 `platform/storage`

- **证据**：`src/stores/data/settingsSlice.ts:141-142`（`browser.storage.local.clear()` / `browser.storage.session.clear()`）。同函数 `:140` 的 `syncMirror.clearAll()` 走的是 platform，唯独清空主体直连。
- **风险**：违反分层红线「stores 不直接写存储」。清空语义（local / session / 镜像三方一致 + 顺序：先清镜像再清 local，否则数据会「复活」）沉淀在 store 里，platform 失去对存储拓扑的唯一掌控，未来新增存储分区极易漏清。
- **改法**：在 `DataRepository` 增 `clearAll()`，内部封装「取消在途写 → 清 sync 镜像 → 清 local → 清 session → 重置降级记账」的顺序语义；store 只调该方法。
- **验收**：`src/stores/**` grep `browser.storage` 零命中；清空后 `check:privacy` 与全部快照测试绿。
- **工作量**：0.5 人日

### A-04 · [P1] v1 范围外的兼容 / 迁移代码

用户明确要求第一版不含版本兼容类能力，实测存在以下 5 处（按性质分类）：

| #   | 位置                                                       | 性质                                                                                                                              | 处置                                                                                                      | 处理状态                                                                                                                |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/core/schema/models.ts:327-344`                        | `EXPORT_FILE_VERSION = 3` + v1→v2→v3 版本史注释 + 「保留旧结构为 `ExportFileV{n}Schema`、老备份走显式迁移路径」的未来兼容意图注释 | **删除注释、版本归 1**。代码上无迁移实现（合规），但注释在为未来兼容埋意图，且 v1 未发布不存在 v2/v3 备份 | ✅ **已处理**：现 `EXPORT_FILE_VERSION = 1`（`models.ts:337`），导入端裸 `z.literal` 无缺省兜底                         |
| 2   | `wxt.config.ts:6,12,75` + `package.json:13` `build:compat` | 兼容变体构建管道，注释自述「V1.0 只发标准版，兼容版随 V2.0 交付」                                                                 | **删除**（重建成本仅 0.5 人日）                                                                           | ✅ **已处理**：`TABS_VARIANT` / hook 变体分支 / `build:compat` / `cross-env` 依赖全部删除                               |
| 3   | `src/entrypoints/popup/`                                   | 标准版产物中 manifest 未引用 `default_popup`，入口不可达却被打包                                                                  | **延后至 V2.0** 或按 `TABS_VARIANT` 条件排除                                                              | ⏸ **仍保留**：兼容变体已删，`TABS_VARIANT` 条件排除这条路不再存在；是否下线待产品拍板（下线需补 manifest `action: {}`） |
| 4   | `src/entrypoints/bookmarks/`                               | **空目录**（无任何文件），随全量构建携带                                                                                          | **删除**                                                                                                  | ✅ **已处理**：另发现并删除 `src/core/memory/`、`src/core/bookmarks/`、`src/ui/bookmarks/` 三个空目录                   |
| 5   | `src/core/insights/workonaImport.ts` + OneTab 导入         | 竞品数据迁移器（非"版本兼容"，但属"迁移"类能力）                                                                                  | **待拍板**，建议见下                                                                                      |

**关于第 5 项的定性说明**：Workona / OneTab 是**竞品数据导入**，与"版本兼容"性质不同，且 OneTab 是「标签囤积者」画像的拉新主路径。建议：**保留 OneTab**（成本低、拉新价值明确），**删除 Workona 迁移器**（`workonaImport.ts` 用 `as` 断言绕过 zod，见 B-06，且目标用户极窄）。最终取舍请你拍板。

- **验收**：`grep -rn 'compat\|migrat\|legacy' src/ wxt.config.ts` 除注释外零命中；`pnpm build` + `pnpm check:privacy` 绿，产物 manifest 权限不变。
- **工作量**：1.5 人日（含删除 Workona 则为 2.0）

### A-05 · [P1] 跨窗口撤销 / 重做丢失分组名

- **证据**：`src/stores/undoStore.ts:698` 取 `useTabStore.getState().groups`（**当前窗口**的组表），而 `:676-679` 的目标标签来自 `queryWindowTabs(redoWindowId)`（可能是**另一窗口**）；`closeRestoredBatch` 同问题见 `:311-313`。对照同文件 `:538-541` 正确写法注释「组名必须在关闭前捕获」。
- **影响**：跨窗口撤销后标签还在、**原生标签组结构丢失**，与 PRD FR-4.4「按原窗口恢复」意图冲突。
- **改法**：改用按 `windowId` 查询的组表（platform 已有 `queryCurrentWindowGroups` 同款能力，扩展为 `queryWindowGroups(windowId)`）；缺 groupName 时显式降级提示而非静默丢。
- **验收**：新增单测「在窗口 B 关闭带组标签 → 撤销 → 组名还原」。
- **工作量**：0.8 人日

### A-06 · [P1] 导出 schema `version` 默认值与注释矛盾

- **证据**：`src/core/schema/models.ts:353` 注释写「`version` 缺省时按 1 处理（容错未带版本号的早期备份）」，`:362` 代码为 `z.literal(EXPORT_FILE_VERSION).default(EXPORT_FILE_VERSION)` —— **缺省实际按 3 通过**。
- **影响**：① 注释与代码矛盾，维护者会按注释误判；② 该 `.default()` 本身是为「未带版本号的早期备份」准备的兼容容错，v1 未发布**不存在**这类备份，属范围外设计；③ 副作用是无 `version` 字段的任意 JSON 都能按当前版本解析，弱化校验。
- **改法**：去掉 `.default()`，`version` 必填；同步修正 `:353` 注释。
- **验收**：新增单测「无 version 字段的备份 → 拒绝导入」。
- **工作量**：0.3 人日

---

## 四、上线前应改（P1，非阻断）

| ID   | 问题                                                    | 证据                                                                                                                                                                            | 改法                                                                                                                                               | 人日 |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| B-01 | 「固定」承载 5 种语义，概念卡建了第一个文件夹后永久消失 | `ui/common/FixedConceptsMap.tsx:6`；只在 `FixedArea.tsx:150` 空态渲染                                                                                                           | 建术语表全量替换（自有概念用「固定磁贴/固定文件夹」，浏览器 pinned 改称「浏览器置顶页」，行内动作改「加入磁贴」）；概念卡常驻为 header 的 `?` 入口 | 1.5  |
| B-02 | 首屏最多 12 段堆叠，标签列表被挤出折叠线                | `sidepanel/App.tsx:1150-1204`（搜索框→提示→工作区条→磁贴条→原生固定区→固定空间→列表）                                                                                           | 合并「原生固定区」与「常驻磁贴条」为一条；固定区折叠阈值 `FixedArea.tsx:37` 从 `>5` 降到 `>2`                                                      | 1.0  |
| B-03 | 工作区 / 空间 / 工作空间 三词并存，与文件夹边界无解释   | locale `spaces.stripLabel`(:612)= 工作区、`search.historyOriginSpace`(:149)= 空间、`palette.sectionFolders`(:486)= 打开文件夹（空间）                                           | v1 统一为「工作区」；在切换 chip 上补一行「工作区 = 文件夹 + 现场快照」                                                                            | 0.5  |
| B-04 | 同一概念两种叫法：常驻磁贴 vs 固定图标                  | `settings.exportDataHint`(zh-CN:236) vs `settings.clearDataHint`(:248)、`clearDataItemFolders`(:251)                                                                            | 全量统一为「常驻磁贴」                                                                                                                             | 0.2  |
| B-05 | 跨平台键位文案两套写法                                  | `ShortcutsSection.tsx:10` 已有 `IS_MAC` 但 `:33-46` 硬编码「⌘K / Ctrl+K」；`search.placeholder`(zh-CN:133) 写「Ctrl+P / ⌘P」                                                    | 抽 `modKey()` 工具，4 个全局快捷键 + placeholder 一并平台化                                                                                        | 0.5  |
| B-06 | Workona 导入用 `as` 断言绕过 zod                        | `core/insights/workonaImport.ts:112`（`JSON.parse(rawText) as WorkonaExport`）                                                                                                  | 定义 zod schema（`z.looseObject` 宽松 + 可选字段），`safeParse` 后遍历；或随 A-04 整体删除                                                         | 0.3  |
| B-07 | 破坏性操作确认不对称                                    | 归档/快照删除/恢复有确认，而「休眠全部」（`FooterToolbar.tsx:174-183`）与「快速整理」常驻一键无确认无影响面预览                                                                 | 执行回执补「已关闭 N 个 · 保留站点 Top3 · 撤销」三段式，复用 `StatusToast`                                                                         | 0.5  |
| B-08 | `react-hooks/exhaustive-deps` 仅 warn                   | `eslint.config.js:19`                                                                                                                                                           | 升为 `error`（至少对 `ui/**` 与 `entrypoints/**`），顺带修现存告警                                                                                 | 0.2  |
| B-09 | 151+ 处 `void x()` 无 catch                             | `entrypoints/background.ts:120,191,265,284,349,354,367,374`；`:433` 的 `.catch(() => {})`                                                                                       | 统一走 `platform/diagnostics.ts` 的 `logDegraded`                                                                                                  | 0.5  |
| B-10 | PRD / README 落后代码两个版本                           | PRD FR-8 落点 `ReadLaterSection.tsx` 文件不存在；README 架构树仍列不存在的 `src/platform/capabilities.ts`；PRD 写 `EXPORT_FILE_VERSION=2/3`，代码为 1；BR-12 标"待排期"但已落地 | 把「PRD 状态回写」列入发布门禁                                                                                                                     | 0.5  | ✅ **已处理**：FR-8/稍后读全量标注下线、架构树按当前代码重写、`EXPORT_FILE_VERSION` 统一为 1、BR-12 标已落地 |

---

## 五、可延后（P2，v1.1）

- **C-01** 超长文件群：`undoStore.ts`(789)、`SnapshotsPanel.tsx`(738)、`settingSections.tsx`(639)、`CommandPalette.tsx`(623)、`background.ts`(519)；其中 `sidepanel/App.tsx` **1388 行**已超出「entrypoints 只组装」边界 —— 2–3 人日，建议分期。
- **C-02** hostname 归一化残留 3 处内联副本：`platform/nocache/noCacheRules.ts:126,134`、`ui/common/CommandPalette.tsx:326`，未走 `core/url/hostname.ts` 的 `normalizeHostname`（缺 www 剥离 / punycode / 尾点归一），口径可能漂移 —— 0.3 人日。
- **C-03** 4 个 core 模块无直测：`core/site/SiteKey.ts`、`core/theme/colorThemes.ts`、`core/url/hostname.ts`、`core/util/id.ts`（均 ≤34 行，多被间接覆盖）—— 0.3 人日。
- **C-04** "恢复是否进撤销栈"注释自相矛盾：代码已实现（`snapshotStore.ts:326-346,359-377`、`undoStore.ts:282-344`），但 `CommandPalette.tsx:347,589` 仍写「恢复不在撤销栈覆盖范围内」，与 `RestoreConfirmDialog.tsx:12-15` 相反 —— 0.1 人日。
- **C-05** 折叠站点记录满 2000 条后是「整表写失败」而非「淘汰最旧」（`models.ts:34` `SITE_COLLAPSE_LIMIT`），会触发无关的全局存储降级横幅 —— 0.3 人日。
- **C-06** 同步镜像读取侧超限静默：`platform/storage/SyncMirror.ts:244` `meta.count > 64` 直接 `return null`，无留痕无 UI 信号；写入侧已有降级横幅但文案未区分「容量超限」 —— 0.3 人日。
- **C-07** 语言兜底落 `zh-CN`：`src/i18n/index.ts:13` 非 `en` 一律落中文，与决策 D6（未支持语言落 `en`）相反 —— 0.1 人日。
- **C-08** 三个浮层（快照面板 / 撤销历史面板 / 命令面板）缺首帧骨架屏 —— 0.3 人日。
- **C-09** 设置搜索不覆盖数据区 / 快捷键区 / 关于区（`options/SettingsPage.tsx:241-243` 静态项不入过滤）—— 0.2 人日。
- **C-10** 术语与文案一致性：`search.keyboardHint` 写「Enter 激活」vs `palette.keyboardHint` 写「Enter 切换」；「从 OneTab 导入」按钮打开的是含 Workona 的导入源选择器（`SnapshotsPanel.tsx:685-692`）—— 0.2 人日。

---

## 六、范围建议：v1 建议砍掉 / 延后

| 能力                                                     | 判定                     | 理由                                                                                   |
| -------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| 兼容变体 `build:compat`、空目录 `entrypoints/bookmarks/` | **删除**                 | 兼容类能力 + 构建噪声                                                                  |
| 备份版本号机（v1→v2→v3 注释与未来迁移意图）              | **删除**                 | v1 未发布，不存在旧备份；保留即诱导未来兼容泥潭                                        |
| Workona 迁移器                                           | **建议删除**（待你拍板） | 迁移类能力 + 目标用户极窄 + 绕过 zod                                                   |
| OneTab 导入                                              | **建议保留**（待你拍板） | 竞品数据导入，是「标签囤积者」画像拉新主路径，成本低                                   |
| `popup` 入口                                             | **延后 V2.0**            | 标准版产物中不可达                                                                     |
| 跨设备同步镜像                                           | **延后**                 | 与「本地优先」宪法有张力；README:74 已过度承诺「首启自动恢复」未真机验证；配额失败静默 |
| 禁缓存 DNR + `<all_urls>` optional 权限                  | **延后**                 | 首次启用弹全站权限警告，与「零权限焦虑」卖点冲突                                       |
| 6 套色相 → 2 套、46 个设置项 → ~20                       | **延后**                 | 个性化是留存手段而非首发手段；46 项使设置页成为第二个产品                              |
| 自动休眠 + 白名单 + 台账 + 通知                          | **可延后**               | 手动/批量休眠已覆盖；自动休眠带来不可预期的系统行为，是信任风险                        |
| 复用引擎（`uniqueUrlTabs` / `reuseAllowance`）           | **不该做**               | 默认关闭、fail-closed、需豁免令牌账本，复杂度远超收益                                  |
| 习惯洞察 + 本地周报                                      | **可延后**               | 锦上添花，且与「一键清理重复」高度重叠                                                 |

---

## 七、v1 缺失的关键体验（供决策）

1. **首屏没有现状陈述**：`insights` 数据已在手（`FooterToolbar.tsx:152`），但只在有洞察时冒出图标，无常驻的「当前窗口 N 个标签 · M 个重复 · K 个可休眠」健康度表达。
2. **无卸载挽留**：`onboarding.exportTip` 只在首启引导终步出现一次；`PRIVACY.md` 明示卸载即清除全部本地数据，卸载时无任何导出提示。
3. **无「文件夹 / 快照 / 归档 / 工作区」的分层解释页**：关于页只讲权限与能力总览，未讲四种留档形态的区别，用户只能靠悟。
4. **洞察入口依赖"有洞察才出现"**：窗口健康时用户永远学不到有这个能力。

---

## 八、评审团做对的地方（请勿在迭代中丢失）

1. **定位收敛在「可逆性」而非「组织」** —— 「不敢关」比「找不到」更真实，撤销栈 / 快照 / 归档统一到「让关变得可反悔」，是与 OneTab（只收不还原现场）、原生标签组（只分组不留档）、Workona（需账号）真正的差异点。
2. **信任可自证** —— 关于页 12 项权限逐条说明 + DevTools 零网络自验教程，把隐私从文档承诺变成用户可自验的功能。
3. **恢复为纯加法 + 强制前置影响面确认**（`RestoreConfirmDialog.tsx:8-12`）—— 承认能力边界并用流程闸门补偿，而非假装能一键回退。
4. **空态即引导** —— 三处空态都带可行动作；`UndoHistoryPanel.tsx:116-128` 在撤销为空但有快照时给崩溃引导。
5. **条件出现的动作入口** —— 清理重复 / 洞察 / 唤醒 / 关闭选中均按 `count > 0` 出现（`FooterToolbar.tsx:139,152,163,184`），底栏不堆永远可点但永远无效的按钮。
6. **三层引导一次性收起**（`App.tsx:1364-1376`），且 Esc 不落盘、可重放 —— 克制且体面。
7. **core 层纯净度 + 100% 覆盖 + 分层 ratchet** —— 工程纪律是这套代码最硬的资产。

---

## 九、修复进度（2026-10-11 执行）

`pnpm check` 全绿：typecheck / lint / check:i18n（766 键、死键 0）/ check:ui / test（112 文件全过）/ build / check:privacy（存储键 29 个与 PRIVACY.md 一致、网络通道调用 0）。

| 项                              | 状态    | 落点                                                                                                                                                  |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 备份导入 url scheme 白名单 | ✅      | 新增 `ImportUrlSchema`（`core/schema/models.ts:415`），非 http(s) 归一为 `about:blank`；新增 3 条契约测试                                             |
| A-02 快速整理可回退             | ✅      | 重排前先存现场快照，存失败即中止（`entrypoints/sidepanel/App.tsx:890`）；提示文案同步两份 locale                                                      |
| A-03 stores 不再直连存储        | ✅      | `DataRepository.clearAllStoredData()`（`platform/storage/DataRepository.ts:170`）                                                                     |
| A-04 范围清理                   | 🟡 部分 | 版本号归 1 + 删除未来迁移意图注释、`build:compat` 与 compat 分支已删、空目录 `entrypoints/bookmarks/` 已删；**Workona 迁移器与 popup 入口保留待拍板** |
| A-05 跨窗口撤销丢失分组         | ✅      | 撤销/重做改按目标窗口取组表（`stores/undoStore.ts:320,710`），`queryCurrentWindowGroups` 更名 `queryWindowGroups`                                     |
| A-06 version 不再缺省兜底       | ✅      | `version: z.literal(...)` 去 `.default()`，测试 fixture 同步补 version                                                                                |
| B-02 首屏减负                   | 🟡 部分 | 固定区折叠阈值 5→2（`ui/fixed/FixedArea.tsx:39`）；「原生固定区 + 磁贴条」合并待做                                                                    |
| B-04 磁贴术语统一               | ✅      | 数据区「固定图标」→「常驻磁贴」                                                                                                                       |
| B-05 修饰键平台化               | ✅      | `modKey` / `modShiftKey`（`options/ShortcutsSection.tsx:13`）                                                                                         |
| B-06 Workona 走 zod             | ✅      | `WorkonaExportSchema.safeParse`（`core/insights/workonaImport.ts:52,128`）                                                                            |
| C-02 hostname 归一              | ✅      | 禁缓存匹配两侧同走 `normalizeHostname`；命令面板改用 `hostnameOf`                                                                                     |
| C-04 撤销栈注释矛盾             | ✅      | `CommandPalette.tsx` 两处过期注释已更正                                                                                                               |
| C-05 折叠记录淘汰               | ✅      | 满 `SITE_COLLAPSE_LIMIT` 淘汰最旧（`stores/data/settingsSlice.ts`）                                                                                   |
| C-06 镜像超限留痕               | ✅      | `MAX_CHUNKS` 超限走 `logDegraded`（`platform/storage/SyncMirror.ts:250`）                                                                             |
| C-07 语言兜底                   | ✅      | 非中文前缀落 `en`（`i18n/index.ts:15`）                                                                                                               |
| C-09 设置搜索覆盖静态块         | ✅      | 静态目录项按标题过滤（`options/SettingsPage.tsx:240`）                                                                                                |
| C-10 文案一致                   | ✅      | 「Enter 激活」→「Enter 切换」                                                                                                                         |
| 附带：PRIVACY.md 口径           | ✅      | 补记 `tabs.auto-discard-rmw`（第 3 节）                                                                                                               |

**未执行（需拍板或属大改）**：B-01 术语全量统一、B-02 合并固定区、B-07 回执三段式、B-08 `exhaustive-deps` 升 error、B-09 `void` catch 收敛（151 处）、C-01 拆超长文件、C-03 core 补测、C-08 浮层骨架屏、Workona/popup 删除、设置项裁剪、同步镜像去留。

## 十、待你拍板的 4 个决策点

1. **OneTab / Workona 是否全删？** 我的建议：保留 OneTab（拉新路径）、删 Workona（见 A-04 第 5 项）。
2. **A-02 快速整理**：降级入口（0.2 人日）vs 重排前自动快照（1.0 人日）？后者更符合产品承诺，但会给快照列表灌入噪声。
3. **设置项 46 → ~20 砍哪些？** 建议保留：主题 / 语言 / 密度 / 聚合阈值 / 拖拽同步 / 撤销栈深 / 自动快照 / 拼音搜索 / 时间线搜索 / 休眠白名单。
4. **跨设备同步镜像**：v1 移除开关，还是保留但加「数据将离开本机」强确认？
