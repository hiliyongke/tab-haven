# Changelog

本项目此前无 CHANGELOG 文件，自本次变更起启用。

## [Unreleased]

### Added

- **卸载挽留**：首次安装与每次启动时注册 `setUninstallURL`，指向随扩展打包的静态页
  `public/uninstall.html`（样式全内联、零外链、**不回传任何查询参数**）。
- **导出提醒**：设置页「数据」分区顶部常驻导出引导（不再依赖引导流程是否完成）。
- **快照恢复可撤销**：恢复快照后，本次新建的标签以 `kind='restore'` 进入撤销栈；
  撤销该批次即关闭这批标签，`⌘Z` 可再开回来。
- **标签行右键菜单**：新增 `ui/common/ContextMenu.tsx`（Portal + `role="menu"` + Esc 关闭 +
  打开时聚焦首项 + 点击外部关闭 + 视口内收拢）。菜单含复制网址 / 加入稍后读 /
  固定 / 休眠 / 复制标签 / 关闭。
- **习惯洞察入口**：底栏在「清理重复」旁独立出现洞察按钮（`insightCount > 0` 时，
  badge 显示条数），点击直达快照面板的洞察区块。
- **静默淘汰提示**：稍后读超限、快照超限、撤销栈超限时，原先静默丢弃的条目
  现在会给一次明确提示（新增 `readlater.evicted` / `snapshots.evicted` / `undo.stackEvicted` 文案）。
  三类上限此前**均无运行时告知**，用户只在打开列表时发现旧数据消失。
  提示按类别去重（会话内各类只提示一次），避免批量操作时提示互相顶掉。
- **撤销栈 kind 扩展**：新增 `restore` 批次类型（`undo.kindRestore`）。

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

- ⚠️ **重复标签保留策略统一（行为变更）**：全应用统一为 `rankForKeep` 口径 ——
  **最近访问 > 激活 > 固定 > 位置靠前 > id 大**。此前 `KeeperPolicy.select` 用的是
  「激活 > 固定 > 位置靠前」，与 `rankForKeep` 不一致（代码内曾有「勿混用」警示）。
  **影响**：组内「激活/位置靠前」的标签不是「最近访问」的标签时，清理保留项会变化。
  该操作可撤销。`duplicates.cleanConfirm` 文案已显式说明保留规则。

### Security

- 诊断日志脱敏范围扩大（见上），降低导出日志中残留完整 URL / 凭据的风险。
