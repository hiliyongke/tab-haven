# Changelog

本项目此前无 CHANGELOG 文件，自本次变更起启用。

## [Unreleased]

### Added

- **卸载挽留**：首次安装与每次启动时注册 `setUninstallURL`，指向随扩展打包的静态页
  `public/uninstall-backup.html`（样式全内联、零外链、**不回传任何查询参数**）。
- **导出提醒**：设置页「数据」分区顶部常驻导出引导（不再依赖引导流程是否完成）。
- **快照恢复可撤销**：恢复快照后，本次新建的标签以 `kind='restore'` 进入撤销栈；
  撤销该批次即关闭这批标签，`⌘Z` 可再开回来。
- **标签行右键菜单**：新增 `ui/common/ContextMenu.tsx`（Portal + `role="menu"` + Esc 关闭 +
  打开时聚焦首项 + 点击外部关闭 + 视口内收拢）。菜单含复制网址 /
  固定 / 休眠 / 复制标签 / 关闭。
- **习惯洞察入口**：底栏在「清理重复」旁独立出现洞察按钮（`insightCount > 0` 时，
  badge 显示条数），点击直达快照面板的洞察区块。
- **静默淘汰提示**：快照超限、撤销栈超限时，原先静默丢弃的条目
  现在会给一次明确提示（新增 `snapshots.evicted` / `undo.stackEvicted` 文案）。
  两类上限此前**均无运行时告知**，用户只在打开列表时发现旧数据消失。
  提示按类别去重（会话内各类只提示一次），避免批量操作时提示互相顶掉。
- **撤销栈 kind 扩展**：新增 `restore` 批次类型（`undo.kindRestore`）。

### Removed

- **稍后读能力整体下线**：移除 `core/readlater`、`platform/readlater`、`stores/readLaterStore`、
  `ui/readlater/ReadLaterSection` 及其测试；页面 / 标签栏右键菜单、标签行右键菜单与
  命令面板的相关入口一并删除；`snapshotStore.archiveItems`（仅服务稍后读归档）同时移除。
- **备份格式单一化**：导出文件不再包含 `readLater` 分区；`EXPORT_FILE_VERSION` 当前为 **1**
  （`src/core/schema/models.ts:337`，导入端 `parseExportFile` 用裸 `z.literal` 校验、无缺省兜底）。
  本产品未发布正式版，**不做跨版本兼容**：版本不同即拒绝，不做跨版本解析。

### Fixed

- **设置项搜索覆盖手写开关**：`syncMirrorEnabled` 从 `SettingsPage` 的手写 Toggle
  改为 `settingSections.tsx` 的 `kind:'custom'` 行，现已可被搜索命中。
- **同步范围说明书**：13 处文案/文档中「仅同步文件夹与设置」的表述补上「常驻磁贴」
  （`MirrorPayloadSchema` 的实际载荷），消除说明书与代码的口径矛盾。
- **重做（redo）可达性**：`UndoHistoryPanel` 增加常驻「重做」按钮，
  `⌘⇧Z` 接线（此前唯一出口是撤销后 7 秒即消失的 toast 按钮）。
- **批量破坏性动作确认**：快速整理 / 清理重复增加确认闸门（带影响面说明）；
  分区关闭的 title 带上数量。
- **popup 三态**：新增 `popup/PopupListStates.tsx`，区分「加载中」「初始化失败（可重试）」
  「真的没有结果」，此前加载中与空结果渲染成同一屏。
- **「其他窗口」分段状态**：`useOtherWindows` 暴露 `status: loading|ready|error`，
  查询在途或失败时有明确状态与重试入口（此前永久空白）。
- **主列表空态引导**：窗口为空且存在快照时，追加「从快照恢复」引导。
- **模态背景惰性化**：`Dialog` 在模态栈首个入栈时给背景加 `inert`
  （不支持的内核退化为 `aria-hidden`），栈清空时解除；嵌套弹窗不会误解除。
- **固定空间滚动边界**：`.fixed-area` 增加底部滚动边界阴影，滚到底时撤掉，
  避免用户滚到一半误以为到底而漏看文件夹。
- **诊断脱敏加固**：`redactUrls` 从单条 `http(s)://` 正则扩展为四条
  （协议头 URL / 裸域名+路径 / 无点分级 `host:port` / `user:pass@` 凭据），
  并先占位保护「文件名:行号」再脱敏，避免 `file.ts:42` 被误判。
- **快照排序回归**：修正 `trimSnapshotsWithEvicted` 中 `b.createdAt - b.createdAt`
  的自比较（排序完全失效）。

### Changed

- **分层归位**：`src/entrypoints/background/`（9 个模块、1300+ 行）整体迁入
  `src/platform/background/` —— SW 的实现模块是「唯一允许触碰 `chrome.*` 的适配层」
  职责，留在入口形态下违反「entrypoints 只组装」；入口只保留事件注册与分发。
- **UI 侧归位**：`useSearchController` → `src/ui/search/`、`useOtherWindows` →
  `src/ui/tabs/`、`ListStates` → `src/ui/common/`（后两者此前被 `ui/` 反向依赖
  或被 options/about 跨形态复用，属分层倒置）。
- **诊断日志内核抽出**：新增叶子模块 `src/platform/log.ts`（脱敏 + 环形缓冲 +
  console + 投递），`platform/diagnostics` 退化为落盘/导出/全局兜底。
  此举切断 `diagnostics ↔ crossPageLock` 的循环依赖。
- **自动休眠台账 RMW 收口**：新增 `src/platform/storage/autoDiscardLedger.ts`，
  追加/淘汰/摘除三处整表读写统一在 `AUTO_DISCARD_RMW_LOCK` 内完成。
- **纯领域选择器下沉**：`planDuplicateCleanup` / `selectSleepableTabs` /
  `selectArchivableTabs` 从 `sidepanel/App.tsx` 迁入 `src/core/tabSelectors.ts`。
- **版本兼容清理（pre-release）**：删除「已移除旧字段不得导致解析失败」这条为
  「旧安装 / 旧备份 / 用户升级」兜底的断言，改为断言 zod 的通用未知键剥离行为；
  `models.ts` 中 4 处「已存设置 / 存量数据」措辞改为中性表述。
- ⚠️ **重复标签保留策略统一（行为变更）**：全应用统一为 `rankForKeep` 口径 ——
  **最近访问 > 激活 > 固定 > 位置靠前 > id 大**。此前 `KeeperPolicy.select` 用的是
  「激活 > 固定 > 位置靠前」，与 `rankForKeep` 不一致（代码内曾有「勿混用」警示）。
  **影响**：组内「激活/位置靠前」的标签不是「最近访问」的标签时，清理保留项会变化。
  该操作可撤销。`duplicates.cleanConfirm` 文案已显式说明保留规则。
- **站点图标改为浏览器本地通道（行为变更）**：`Favicon` 不再渲染站点自身的图标地址，
  改按**页面地址**走 `chrome-extension://<id>/_favicon/`（为此新增 `favicon` 权限）。
  此前那是本产品**唯一的第三方出站请求**，且在鉴权站点上会被 302 带到登录页再跳回来
  （一次约 25 跳、最终 `ERR_TOO_MANY_REDIRECTS`）。副作用是 Icons 覆盖面变好：
  `tab.favIconUrl` 为空的标签此前只能显示首字母，现在也能取到图标。
  实测同一窗口：请求数 46（37 个外部）→ **19 个，全部为本扩展本地地址**。
  调用点由传「图标地址」改为传「页面地址」：`RowItem.faviconSrc` → `faviconPageUrl`、
  `PinnedTile` / `CommandPalette` / 拖拽 `DragData` 的 `favIconUrl` → `url`。

### Fixed

- **撤销栈可整体失效（P1）**：`enqueueUndoPersist` / `enqueueRedoPersist` 此前把
  未兜底的 promise 返回给调用方（只把已 catch 的那一个接进串行链）。锁请求在
  上下文销毁时以 AbortError reject，撤销恢复期间关闭面板即触发 —— `load()` 的
  `ready` 会永久停在 false，此后每次关闭标签都重跑必然失败的 load，撤销批次
  再也入不了栈。现返回已兜底的 promise。
- **自动休眠撤销出口丢失（P1）**：台账三个写入方（SW 追加 / SW 淘汰 / 面板
  「全部唤醒」）此前都做锁外整表 read-modify-write，并发时 last-writer-wins，
  表现为「唤醒入口点了没反应」或「该轮休眠没有撤销出口」。现统一收口到锁内。
- **归档应答可被永久挂起（P2）**：`skipMarkerChain` 缺第二道保险，一次 reject 后
  此后每个 `markSkipAutoSave` 都不再 resolve，归档流程挂满 ack 超时才降级。
- **面板台账读取失败不可分辨（P2）**：空 `.catch(() => {})` 改为 `logFailure` 留痕。
- **重试定时器可能泄漏（P2）**：句柄从 effect 内局部 `let` 改为 `useRef`，
  StrictMode 双挂载下 cleanup 才能清到前一次排上的定时器。
- **连点穿透（P2）**：`UndoHistoryPanel` 恢复、`SnapshotsPanel` 恢复/删除的互斥
  改用 `useRef` —— 渲染期 state 在同一 tick 内读到的都是旧值，连击会双双进入执行体。
- **坏数据恢复后回写无回执（P2）**：`DataRepository` 恢复写失败（配额）时留痕，
  避免每次读盘静默重跑逐元素恢复。
- **超限关闭失去撤销登记（P2）**：`reuse-closed` 消息超 `REUSE_CLOSED_LIMIT`（50）
  时整条被 schema 拒绝静默丢弃，改为按上限截断并留痕。
- **右键「加入文件夹」无成功反馈（MV3 上下文菜单动作必须有反馈）**：
  `addEntryToFolder` 改为三态返回（added / exists / failed）；此前写入失败会被
  外层统一报成「已在文件夹中」，与内部发出的失败通知语义冲突。
- **样式与风格**：background 内 3 处 `.then()` 链改 async/await。

### Security

- 诊断日志脱敏范围扩大（见上），降低导出日志中残留完整 URL / 凭据的风险。
- **「零出站网络请求」不再有任何例外**：站点图标改走浏览器本地 `_favicon` 通道后，
  扩展不再向任何被浏览站点发起请求。`PRIVACY.md` 第 1 节（原「唯一的外部请求」条目）
  与第 2 节权限表已同步；`scripts/privacy-check.mjs` 的图标渲染闸门同步收紧为
  「只允许 `_favicon` 通道、且 `src` 必须来自 `buildFaviconSrc`」。
