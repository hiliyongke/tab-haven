# Tabs 全量代码审查与修复验收报告

> 日期：2026-10-30
>
> 范围：`core`、`platform`、`stores`、`ui`、`entrypoints`、后台任务、持久化/schema、构建与隐私脚本、官网、i18n-kit 及测试配置。
>
> 口径：按根因合并同类项；一个条目可包含多个调用点与回归测试。UI 的逐项清单、工作量和排除项见 `UI-REVIEW.md`。

## 0. 结论

**审查结论：Approve。本轮确认的 P0 / P1 / P2 项均已修复并补回归验证；当前没有已知的未解决门禁失败或代码级阻断项。**

- 初始基线在测试阶段失败；收尾时完整 `pnpm check` 已通过，包括类型、lint、文案、UI、全量测试与覆盖率、生产构建、隐私扫描。
- 未新增权限、未引入网络通道、未修改门禁阈值、未添加 `lint-disable` / `@ts-ignore`、未降低覆盖率要求。
- 审查修复阶段未执行 Git 写操作；最终提交与推送由用户明确要求后执行。
- 静态审查与自动化测试不能证明“绝对不存在未知缺陷”。当前残余风险主要是浏览器真实并发时序、Chrome API 与 fake-browser 的差异、触屏和读屏的实际体验，建议按第 5 节人工验收。

## 1. 最终验证证据

| 验证                 | 实际结果                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| `pnpm format:check`  | 通过，全仓符合 Prettier                                                    |
| `pnpm typecheck`     | 通过，扩展、i18n-kit、根配置均为 0 类型错误                                |
| `pnpm lint`          | 通过，0 错误、0 警告                                                       |
| `pnpm check:i18n`    | 809 条：808 条翻译 + 1 条豁免；未登记 0，无裸露中文                        |
| `pnpm check:ui`      | 42/42 通过                                                                 |
| 扩展全量测试         | **160 文件 / 1670 条全部通过**，含覆盖率 ratchet                           |
| 覆盖率               | Statements 79.69%、Branches 72.39%、Functions 76.19%、Lines 81.51%；未下降 |
| i18n-kit 测试        | 6 文件 / 54 条全部通过                                                     |
| 根级跨包守卫         | 1 文件 / 7 条全部通过                                                      |
| 聚合测试合计         | **167 文件 / 1731 条全部通过**                                             |
| `pnpm build`         | 通过，Chrome MV3 产物 2.07 MB，位于 `.output/chrome-mv3`                   |
| `pnpm check:privacy` | 通过；34 个存储键与 `PRIVACY.md` 一致，权限一致，网络通道调用 0            |
| `pnpm site:check`    | 通过；官网类型/lint/i18n、5 条安全测试和构建自检全绿                       |
| 完整 `pnpm check`    | **通过**，串行完成 typecheck → lint → i18n → UI → test → build → privacy   |

分区复核还独立跑过：platform/background/core 82 文件 986 条、stores 27 文件 208 条、UI 41 文件 428 条；最终全量门禁再次覆盖了这些测试及本轮新增用例。

## 2. P0：隐私红线与不可逆数据保护

| 位置                                                                                                                                                        | 问题与根因                                                                                                 | 修复与验收                                                                                                                                                 | 人日 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `apps/extension/src/platform/storage/DataRepository.ts:134`；`apps/extension/src/stores/undoStore.ts:169`；`apps/extension/src/stores/snapshotStore.ts:271` | 写前基线若沿用展示态降级读取，存储 area 缺失或 I/O 故障会被当成空数据，后续写盘可能覆盖真实数据。          | 新增并使用 `readStrict()`：写前读取失败即中止；展示/初始化仍可用 `read()` 降级。故障注入测试证明磁盘与内存保留原值，导入、快照、撤销、镜像等写路径均覆盖。 | 0.8  |
| `PRIVACY.md` 第 3.1-c 节；`apps/extension/src/platform/storage/crossPageLock.ts:60,72`                                                                      | 新增 `tabs.pending-actions-rmw`、`tabs.sync-mirror-rmw` 协调锁名后，隐私文档清单未同步，属于文档口径漂移。 | 将两个锁名登记到既有协调锁表；它们不写入存储、不保存浏览数据。`check:privacy` 验证 34 键一致。                                                             | 0.1  |

## 3. P1：正确性、并发、恢复对称与用户可感知缺陷

### 3.1 撤销、重做与恢复

| 位置                                                                                                                                                                                                                          | 问题与根因                                                                                                   | 修复与验收                                                                                                                                                                                                                         | 人日 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `apps/extension/src/platform/undo/RestoreEngine.ts:17-35,61-68`；`apps/extension/src/core/undo/UndoStack.ts:80-97`                                                                                                            | 重做按 URL 反查时，可能关闭用户原本就打开的同 URL keeper；已存在页面被跳过与真实新建也没有区分。             | 恢复结果返回 `createdTabIds`、`skippedAlreadyOpen`、失败明细；真实 id 一旦存在即为权威，空 id 集不再回退 URL 猜测。测试覆盖 keeper 排在前面、跳过已打开、创建失败等场景。                                                          | 0.8  |
| `apps/extension/src/stores/undoStore.ts:59-73,437-476`                                                                                                                                                                        | 重试仍失败时会删掉既有重做批次的真实 id；多次部分成功又会压入同 id 重做批次并覆盖映射，导致漏关或误关。      | 仅在重做栈不再持有该批次时删除映射；同 id 的部分成功合并 entries 与真实 id，内存和磁盘使用同一 `pushMergedRedoBatch` 口径，写失败仍回滚到原映射。回归覆盖“再次失败”和“第二次部分成功”，后者一次重做只关闭 `[2,3]`，不关闭 keeper。 | 0.7  |
| `apps/extension/src/platform/undo/RestoreEngine.ts:78-82,120-169`                                                                                                                                                             | 同批重建组时，不同旧组可能误合并；新建组 id 若撞上另一旧组 id，还会被当成“原组”复用。                        | 以旧 groupId 记录重建映射，并单独记录 `createdGroupIds` 禁止新 id 作为其他旧组的原组。补充同名不同旧组、id 碰撞、标题回写失败、加入重建组失败测试；RestoreEngine 22/22 通过。                                                      | 0.5  |
| `apps/extension/src/stores/undoStore.ts:100,652`；`apps/extension/src/stores/snapshotStore.ts:65,154`；`apps/extension/src/ui/fixed/FolderItemRow.tsx`；`apps/extension/src/entrypoints/sidepanel/hooks/useSpaces.ts:223-253` | 调用方在 await 后读取“栈尾/最新空间”，可能拿到其他操作的记录；固定条目撤销和新空间激活因此可能指向错误目标。 | `closeWithUndo` 返回本次真实 batchId，`saveSpace` 返回本次真实 snapshotId；UI 只消费返回值，失败/空现场返回 `undefined`，不伪造成功。                                                                                              | 0.5  |

### 3.2 存储、后台与跨上下文并发

| 位置                                                                                                                                                                                      | 问题与根因                                                                                                             | 修复与验收                                                                                                                                          | 人日 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `apps/extension/src/platform/storage/crossPageLock.ts:60`；`apps/extension/src/platform/background/shared.ts:124`；`apps/extension/src/platform/messages.ts:209`                          | 后台入队与面板“读取→消费→删除”挂起动作未互斥，旧快照可能删掉新动作。                                                   | 增加 `PENDING_ACTIONS_RMW_LOCK`，生产与消费均在锁内重读并精确删除。相关 shared/messages 43 条测试通过。                                             | 0.4  |
| `apps/extension/src/platform/storage/SyncMirror.ts:49-67,249-289,317-347`                                                                                                                 | 镜像写块、清理、拉取跨上下文交错会互相覆盖；固定块键与失败清理可能复活旧数据或误删他人在途块。                         | 写/清/拉统一跨页锁；每次写入使用独立 generation 块键，只回收本次未提交块和已切换旧代；`performClear` 失败向上抛出。覆盖并发、失败、代际与禁推测试。 | 0.8  |
| `apps/extension/src/platform/storage/session.ts:42-54,134-136`                                                                                                                            | session 写失败后，后续读取可能退回旧磁盘值并覆盖内存中的新变更。                                                       | 保留本上下文 `volatileSession` dirty 基线，只有成功落盘才清除；后续 mutation 从最新内存值继续。                                                     | 0.3  |
| `apps/extension/src/platform/reuse/ReuseCoordinator.ts:82,146-191`；`apps/extension/src/platform/reuse/persistClosed.ts:14-25`                                                            | 扫描期间到达的更新可能被结算删除；`setEnabled(false)` 后在途任务仍可能关闭标签；无面板时后台关闭记录未进入撤销库。     | 以 dirty 标记保留在途更新，扫描后复核开关；后台通过 `persistReuseClosedBatch` 补登记真实关闭记录。测试覆盖无面板、在途禁用和 dirty 更新。           | 0.6  |
| `apps/extension/src/platform/background/autoSnapshot.ts:29-46,81-102`                                                                                                                     | 自动快照签名未按窗口隔离，多窗口相同/变化现场可能互相抑制或误写。                                                      | 以 `windowId` 分桶保存签名，旧快照仅作迁移期回退；逐窗口采集与失败降级。                                                                            | 0.4  |
| `apps/extension/src/platform/background/autoGroup.ts:58-72,123-151`；`apps/extension/src/platform/sync/TabSyncService.ts:78-120`；`apps/extension/src/platform/background/autoDiscard.ts` | 合并调度、trailing 查询、失败重试与后台休眠边界存在事件丢失或永久轮询风险。                                            | 保留等待期间的新事件，trailing 消费与重试按最新状态结算；同步快照带 generation，连续失败退避并限制无意义诊断。对应后台与同步测试全绿。              | 0.7  |
| `apps/extension/src/platform/log.ts:88-132`；`apps/extension/src/platform/diagnostics.ts`                                                                                                 | IPv4 带端口/路径会分段脱敏；源码路径与 `sidePanel.open` 被误当 URL；`.md` / `.sh` 文件白名单又会漏掉真实公共后缀域名。 | 统一 URL 脱敏与有限 token 保护：保留源码位置和代码 API，真实 URL 一律脱敏；跨上下文诊断按代际防旧写覆盖。补 IPv4、路径、API、`.md/.sh` 与代际回归。 | 0.5  |

### 3.3 core、schema 与导入边界

| 位置                                                                                                        | 问题与根因                                                                        | 修复与验收                                                                                         | 人日 |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---- |
| `apps/extension/src/core/schema/models.ts:327-395`                                                          | 备份内 folder/item 与 snapshot id 可重复，后续按 id 操作会出现歧义或错误引用。    | 在唯一 schema 层增加 folder/item 全局及 snapshot id 唯一性校验；非法备份拒绝，不只靠 UI 输入校验。 | 0.4  |
| `apps/extension/src/core/site/Sections.ts:229-257,318-325`                                                  | 同域名不同端口在部分聚合分支使用不同键，导致拆分/合并口径不一致。                 | 全链路统一 `siteBucketId`，补混合端口聚合测试。                                                    | 0.3  |
| `apps/extension/src/core/url/hostname.ts`                                                                   | hostname 解析未完整处理 `?` / `#` 边界，可能把 query 或 fragment 纳入主机判断。   | 修正主机截断规则并补边界测试，继续复用唯一 URL 判定实现。                                          | 0.2  |
| `apps/extension/src/core/snapshot/oneTabImport.ts`                                                          | 有效条目恰好达到上限时，尾部无效行可能被错误计入/截断，导入结果与提示不一致。     | 按有效条目计数并明确处理恰上限与尾部无效行，补边界测试。                                           | 0.2  |
| `apps/extension/src/core/reuse/AllowanceLedger.ts:91-117`                                                   | SW 恢复豁免快照时未先清理过期项，过期时间与恢复合并可能留下陈旧豁免。             | restore 先 sweep，并钳制最大有效期；覆盖重启恢复与过期边界。                                       | 0.3  |
| `apps/extension/src/core/fixed/FolderOps.ts`；`apps/extension/src/stores/data/folderSlice.ts:60-69,314-325` | 文件夹上限只在渲染态或调用方判断时，并发/导入可超限，且可能给未落盘条目建立绑定。 | 在 updater 最新基线上执行上限与目标存在性判断，失败返回明确结果，不创建悬空绑定。                  | 0.4  |

### 3.4 UI、异步反馈与可访问性

| 位置                                                                                                                                                                                                                       | 问题与根因                                                                                       | 修复与验收                                                                                                            | 人日 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---- |
| `apps/extension/src/ui/snapshot/useSnapshotImport.ts`；`SnapshotRow.tsx`；`SnapshotsPanel.tsx`                                                                                                                             | 导入在途可重入生成重复快照；重命名 Enter/Escape/blur 相互重复提交；删除后无回执且焦点掉回 body。 | 加在途 ref 与 busy 状态、编辑会话幂等标尺、删除成功回执和稳定焦点归还。                                               | 1.0  |
| `apps/extension/src/entrypoints/sidepanel/hooks/useSpaces.ts:62-67,137-193,223-253`                                                                                                                                        | 工作区准备期与保存在途可连点重入；激活失败仍可能报成功。                                         | 首个 await 前占用统一切换守卫，待确认/取消/执行共享；保存链路独立互斥，只有真实 id 激活落盘后才报成功。               | 0.6  |
| `apps/extension/src/ui/common/StatusBadges.tsx`；`ListStates.tsx`；`StatusToast.tsx`；`UndoHistoryPanel.tsx`；`apps/extension/src/entrypoints/sidepanel/App.tsx`                                                           | 休眠徽章命名无效、骨架无加载语义、toast 动作可重入、加载中误显示空态、搜索漫游缺少读屏播报。     | 使用 sr-only/role/status/aria-busy/live region 和在途禁用，区分 loading/empty/error。                                 | 1.0  |
| `apps/extension/src/ui/common/ColorSwatchGroup.tsx`；`ContextMenu.tsx`；`apps/extension/src/ui/dnd/DndRoot.tsx`；`apps/extension/src/entrypoints/sidepanel/FooterToolbar.tsx`；`apps/extension/src/ui/fixed/FixedArea.tsx` | radiogroup 无方向键漫游；固定区、底栏和菜单存在键盘入口不对称；键盘拖拽提示使用鼠标语义。        | 增加 roving tabindex、Alt 方向重排、Shift+F10/ContextMenu 键、固定区漫游和按输入方式切换提示。                        | 1.0  |
| `apps/extension/src/ui/settings/settingControls.tsx`；`SettingsOutline.tsx`；`apps/extension/src/ui/search/SearchBar.tsx`                                                                                                  | 设置校验错误未与输入关联，复合控件缺组语义，目录只滚动不移焦点，toggle 可访问名随状态变化。      | 补 `aria-invalid` / `aria-describedby` / `role=group` / alert，焦点显式迁移，toggle 使用稳定名称和 `aria-pressed`。   | 0.8  |
| `apps/extension/src/ui/tabs/TabRow.tsx`；`VirtualRowList.tsx`；`TabRowActions.tsx`；`apps/extension/src/ui/fixed/FolderItemRow.tsx`                                                                                        | 行激活/位置状态缺少真实集成验证；触屏无法打开复制网址等菜单；固定条目静音布尔失败被当成功。      | 补齐 `aria-current`、`aria-posinset`、`aria-setsize` 集成断言，触屏更多操作入口，静音按 `Promise<boolean>` 结果反馈。 | 0.5  |

UI 专项共确认并处理 P1×6、P2×14 及其复审追加项；完整逐项位置、排除的误报和实现说明见 `UI-REVIEW.md` 第 2、3、5 节。

## 4. P2：工具链、一致性与维护性技术债务

| 位置                                                                                                 | 技术债务                                                                                                       | 修复与验收                                                                                              | 人日 |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---- |
| `apps/extension/scripts/privacy-check.mjs`；`apps/extension/scripts/csp-policy.ts`                   | 网络扫描漏掉 `fetch?.()`、`(0, fetch)()` 等形态；CSP 校验未完整约束必需指令/来源，可能让防线静默失效。         | 扩展扫描形态并校验 CSP 必需项；`privacy-csp` 与最终隐私扫描通过。                                       | 0.5  |
| `apps/extension/scripts/pack-crx.mjs:39-104,193`；`pack-crx-process.ts:4-29`                         | CRX 身份记录非原子写入，空/损坏身份可能被当首次打包；签名密钥缺失或 stale RAW_KEY 可造成身份漂移或“成功”假象。 | 身份文件 tmp+rename+pid；显式轮换才允许换身份；首次必须有 PEM；成功签名后才记录身份。8 条过程测试通过。 | 0.7  |
| `packages/i18n-kit/src/collect.ts:238-291`；`commands/check.ts:145`                                  | 嵌套 JSX 错误未向上传递；`emptyAllowed` 可能豁免非“为空”问题，导致守卫假绿。                                   | 嵌套遍历传递 `onError`，稳定空元素条件豁免；`emptyAllowed` 仅豁免为空原因。i18n-kit 54/54。             | 0.4  |
| `packages/i18n-kit/package.json:47`                                                                  | 工具包 engines 与仓库实际支持的 Node 范围不一致。                                                              | 调整为 `^22.18.0                                                                                        |      | >=24.11.0`，与运行时要求对齐。 | 0.1 |
| `tests/config/dependency-integrity.test.ts`                                                          | Windows 反斜杠路径不能正确定位包目录，跨平台依赖单副本守卫可能失效。                                           | 同时解析 POSIX/Windows 路径；7 条依赖守卫通过。                                                         | 0.2  |
| `apps/site/lib/external-requests.mjs`；`apps/site/lib/html.mjs:18-71`；`apps/site/build.mjs:108-142` | 官网外链扫描对无点主机名、同域相似路径与 SITE_URL origin 的判定不严；JSON-LD 内嵌序列化存在提前闭合风险。      | 使用精确 origin 与完整受禁 API 检测，安全序列化 JSON-LD；5 条安全测试与零外链构建自检通过。             | 0.5  |
| `apps/extension/src/platform/bookmarks.ts`；相关测试                                                 | 书签导入来源文案与中文母语原文/i18n 口径不一致。                                                               | 统一中文原文与词典产物，809 条文案检查通过。                                                            | 0.1  |

## 5. 残余风险与人工验收建议

当前没有已知未修复的自动化门禁项。建议按以下顺序做最终人工验收：

1. **发布前复验**：执行 `pnpm format:check && pnpm check && pnpm site:check`。
2. **真实扩展加载**：在 Chrome/Edge 加载 `.output/chrome-mv3`，确认 sidepanel、options、background 无启动异常。
3. **撤销/重做**：构造同 URL 既有标签、部分恢复失败、再次重试、同名不同组及多窗口场景，确认只操作本次恢复标签，分组不串组。
4. **工作区与导入**：连点工作区切换/保存、OneTab/Workona 导入、静音与固定条目移出，确认不会重复创建，失败有可见反馈。
5. **可访问性与触屏**：用 VoiceOver 或 NVDA 检查首次 toast、搜索漫游、设置错误、删除/重命名焦点；在触屏或窄面板验证更多操作、底部键盘重排和拖拽提示。

整体风险评估：**高风险的误关标签、默认覆盖写盘、跨上下文丢动作与隐私文档漂移已消除；自动化层面可交付。真实浏览器与辅助技术的人工场景仍是最终发布前的必要补充。**
