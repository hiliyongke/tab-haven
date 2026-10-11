# Chrome Web Store Listing — Tabs

> Last Updated: 2026-10-11
> 本文件是上架元数据的唯一来源；改名 / 改权限 / 改数据口径都必须先改这里，再改 `PRIVACY.md` 与 `wxt.config.ts`。

## Store Listing

**Extension Name** `Tabs`
<!-- 与 manifest 的 __MSG_extName__ 一致（`public/_locales/*/messages.json`），75 字符内。 -->

**Short Description**（132 字符内）

> Organize, search, and recover your tabs from a local side panel — grouped by site, saved in collections, always undoable.

中文（商店本地化文案）：

> 把散乱的标签整理成一个本地侧边栏：按站点聚合、收进文件夹、关错了也能一键找回。

**Detailed Description**

> Tabs turns a crowded browser window into an orderly workspace — and makes sure you can always find your way back.
>
> Everything happens on your own computer. There is no account to create, no sign-in, and nothing is uploaded: the extension never contacts a server of its own, and it contains no analytics or tracking of any kind.
>
> Group tabs by site automatically, or drag them into your own collections. Pin the pages you always come back to. Search by title, address, or even pinyin initials and jump straight to a tab. Close a batch by accident? Undo it — repeatedly. Save the whole window as a snapshot before you shut down, and restore only what you actually need later. Freeze tabs you are not using to free up memory, then wake them all with one click. Clean up duplicates in one pass, keeping the tab you were actually using.
>
> Open the panel from the toolbar icon, a keyboard shortcut, the right-click menu, or by typing `t` in the address bar. Drag to reorder anything. Everything is keyboard-navigable, and the interface ships in English and Simplified Chinese with light, dark, and system themes.
>
> Your data stays in your browser's own local storage. If you turn on the optional cross-device switch, your collections, pins, and settings are mirrored through your own browser account's sync — Tabs never operates that channel and never sees the data. It is off by default, and turning it off deletes the mirror. You can export everything to a JSON file at any time, and uninstalling removes all local data.
>
> Site icons shown next to tabs are fetched by your browser directly from the site they belong to — the only outgoing request involved, and one Tabs does not read or record.
>
> Free forever, with no ads and no upsells. Questions or bugs: open an issue at the project repository.

**Category** `Productivity`

**Single Purpose**

> Organize, search, and recover your browser tabs from a side panel.

**Primary Language** `English`（界面同时提供简体中文）

## Graphics & Assets

| Asset                          | Dimensions          | Status         | Filename                              |
| ------------------------------ | ------------------- | -------------- | ------------------------------------- |
| Store Icon [REQUIRED]          | 128×128 PNG         | ✅ Ready       | `public/icon/128.png`                 |
| Screenshot 1 [REQUIRED]        | 1280×800 或 640×400 | ⬜ Not created | 主界面：侧边栏标签列表 + 站点聚合分组 |
| Screenshot 2 [RECOMMENDED]     | 同上                | ⬜ Not created | 搜索：模糊搜索命中高亮 + 键盘导航     |
| Screenshot 3 [RECOMMENDED]     | 同上                | ⬜ Not created | 固定空间：文件夹 + 常驻磁贴           |
| Screenshot 4                   | 同上                | ⬜ Not created | 撤销历史面板：多层撤销 + 最近关闭     |
| Screenshot 5                   | 同上                | ⬜ Not created | 信任面板：12 项权限逐条说明           |
| Small Promo Tile [RECOMMENDED] | 440×280             | ⬜ Not created |                                       |
| Marquee Promo Tile             | 1400×560            | ⬜ Not created |                                       |

### Screenshot Notes

- 截图必须是**当前 v1.0 UI 的真实画面**，不要放手机/平板外壳（本扩展只在桌面浏览器侧边栏运行）。
- 截图里出现的网址建议用示例站点，避免暴露真实浏览记录。
- 至少 1 张需包含侧边栏在真实浏览器窗口中的形态（能看出是侧边栏，而非独立网页）。

## Permissions Justification

来源：`wxt.config.ts:19-37`（权限清单与 `optional_host_permissions`）与 `PRIVACY.md` 第 2 节。**两者必须逐项一致**，否则 `pnpm check:privacy` 失败。

| Permission              | Type                      | Justification（面向审核团队，填 dashboard 用）                                                                                                               |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tabs`                  | permissions               | 在侧边栏里列出并管理你当前窗口的标签：显示标题、地址、图标与固定/静音状态，并支持切换、关闭、休眠、排序。不读取浏览器历史记录，数据只留在本机。              |
| `tabGroups`             | permissions               | 识别并同步 Chrome 原生标签组：把同域名标签聚合后可选「同步为原生标签组」，解散时只清理本扩展创建的组。                                                       |
| `storage`               | permissions               | 把你创建的文件夹、常驻磁贴、快照与设置保存在本机浏览器存储中；离线可用，卸载即清除。                                                                         |
| `alarms`                | permissions               | 仅在你开启「自动休眠」或「定时自动快照」后，按周期检查标签状态（MV3 后台会被回收，闹钟是唯一可靠的调度方式）。两项默认关闭。                                 |
| `contextMenus`          | permissions               | 在网页、链接、标签栏与工具栏图标的右键菜单里提供「休眠 / 固定 / 加入文件夹 / 按域名搜索 / 打开面板」快捷操作。                                               |
| `omnibox`               | permissions               | 让你在地址栏输入 `t` 加关键词，直接搜索已打开的标签、固定条目与文件夹并回车打开。                                                                            |
| `sessions`              | permissions               | 在撤销历史面板中显示浏览器最近关闭的标签与窗口，供你一键恢复（浏览器自身的会话数据，本扩展不保存）。                                                         |
| `bookmarks`             | permissions               | 仅在**你主动点击**时使用：把固定文件夹导出为书签，或从书签栏导入为固定文件夹。不会在后台读取书签。                                                           |
| `notifications`         | permissions               | 执行自动休眠或后台动作后，在本机弹出一次系统通知告知结果（通知内容仅为本机文案）。                                                                           |
| `sidePanel`             | permissions               | 在浏览器侧边栏中展示主界面（这是本扩展的默认形态）。                                                                                                         |
| `declarativeNetRequest` | permissions               | 供可选的开发者功能「指定站点禁缓存」：按你填写的站点改写该站点响应的缓存头。**不拦截请求、不读取页面内容、不上传任何数据。**                                 |
| `<all_urls>`            | optional_host_permissions | **默认不授予**。仅当你主动开启「禁缓存」开关时由浏览器弹窗询问，用于让上一条的响应头改写在你指定的站点上生效；拒绝则该功能保持关闭，可随时在扩展详情页收回。 |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** **No**（Tabs 无自有服务器、无账号、无遥测。）

| Data Type                    | Collected?   | Transmitted Off-Device?          | Purpose                                | Shared with Third Parties? |
| ---------------------------- | ------------ | -------------------------------- | -------------------------------------- | -------------------------- |
| Personally identifiable info | No           | No                               | —                                      | No                         |
| Health info                  | No           | No                               | —                                      | No                         |
| Financial info               | No           | No                               | —                                      | No                         |
| Authentication info          | No           | No                               | —                                      | No                         |
| Personal communications      | No           | No                               | —                                      | No                         |
| Location                     | No           | No                               | —                                      | No                         |
| Web history                  | **本地处理** | **否**（除非开启同步镜像，见下） | 在侧边栏展示与组织当前窗口标签         | No                         |
| User activity                | **本地处理** | 否                               | 撤销栈 / 快照 / 习惯洞察（纯本地计算） | No                         |
| Website content              | No           | No                               | —                                      | No                         |

**两条必须在披露表单里如实申报的例外**（不申报 = 口径不一致 = 拒审风险）：

1. **跨设备同步镜像（默认关闭）**：开启后文件夹、常驻磁贴与设置会经 `chrome.storage.sync` 通过用户自己的浏览器账号通道同步 —— 这在 CWS 口径下属于**离设备传输**，必须勾选并说明：「默认关闭，仅传输用户主动固定的条目与设置，Tabs 不经手」。
2. **站点图标**：侧边栏里的站点图标由浏览器向**该站点自身**发起一次图片请求（`referrerPolicy="no-referrer"`）。Tabs 不接收、不记录、不拼接自有地址。建议在「网站内容」一项说明为「不读取，仅由浏览器渲染站点图标」。

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED] ⬜ **待填**

建议：把根目录 `PRIVACY.md` 发布到公开可访问地址（GitHub Pages / 仓库 README 锚点均可），**内容必须与上面的披露表单逐条一致**。填写后把本行改为实际 URL，并在下方 Version History 之外记录一次「隐私政策已上线」。

## Distribution

**Visibility**：Public
**Regions**：All regions

## Developer Info

**Publisher Name** [REQUIRED] ⬜ 待填
**Contact Email** [REQUIRED] ⬜ 待填（必须是会看的邮箱，Google 的下架/政策通知发到这里）
**Support URL** [RECOMMENDED] ⬜ 待填（建议用仓库 Issues）
**Homepage URL** [RECOMMENDED] ⬜ 待填（建议用仓库地址）

## Version History

| Version | Date       | Changes                                                                                                                                          | Status |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1.0.0   | 2026-10-11 | 首个上架版本：侧边栏标签组织、站点聚合、固定空间、模糊搜索与键盘流、拖拽排序、多层撤销、快照与归档、重复治理、习惯洞察、休眠与资源、备份导入导出 | Draft  |

<!-- 后续每次提交商店都要新增一行；Status: Draft | Submitted | In Review | Published | Rejected -->

## Review Notes

### Known Issues / Limitations（审核可能追问的点）

1. **`<all_urls>` 走 optional 而非默认授予** —— 这是本文件的核心说服点，务必在 dashboard 的权限理由里写明「默认不授予、按需请求、可随时收回」。
2. **`tabs` 权限的通用提示** —— Chrome 会把 `tabs` 显示为「读取你的浏览历史」。在描述与隐私政策里说明本扩展只读当前窗口标签元数据、不读历史。
3. **单一用途（Single Purpose）** —— 功能面较宽（组织 / 快照 / 洞察 / 休眠）。统一口径：**这些都是「标签与会话的组织与恢复」这一件事**，不要描述成「效率套件」这类泛化说法。
4. **右键菜单的 `tab` 上下文**（`src/platform/background/contextMenus.ts:155,162,167`）需较新 Chrome；旧内核上这几项会缺失（已做逐项兜底，只丢这几项）。上架前确认目标版本表现。
5. **零网络** 可通过扩展内「信任面板」的 DevTools 自验证教程复现，审核问起时可指引到该功能。

### Rejection History

| Date | Reason | Fix Applied | Resubmitted |
| ---- | ------ | ----------- | ----------- |

## 发布前自查（Pre-Publish Checklist）

| 项                                         | 状态            | 说明                                                                                                                                                                                                |
| ------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| manifest_version = 3                       | ✅              | WXT 生成                                                                                                                                                                                            |
| 版本号 > 已发布版本                        | ✅              | 首次提交 1.0.0                                                                                                                                                                                      |
| name 与本文档一致                          | ✅              | `Tabs`                                                                                                                                                                                              |
| manifest description ≤ 132 字符            | ✅              | `_locales/*/messages.json` 的 `extDescription`                                                                                                                                                      |
| ZIP 不含开发文件                           | 🟡 需确认       | `pnpm zip` 走 WXT 打包；**需额外排除 `.codebuddy/`、`.output/` 之外的覆盖率目录**，并确认 `CHROMEWEBSTORE.md` / `README.md` / `docs/` 未进包                                                        |
| ZIP < 10MB                                 | 🟡 待测         | 构建后确认                                                                                                                                                                                          |
| 权限最小化 + 逐项理由                      | ✅              | 见上表；`<all_urls>` 为 optional                                                                                                                                                                    |
| 无未使用权限                               | ✅              | `check:privacy` 双向比对                                                                                                                                                                            |
| 描述具体、无夸大、无关键词堆砌             | ✅              | 见 Store Listing                                                                                                                                                                                    |
| 无商标侵权                                 | ✅              | 名称 `Tabs` 为通用词，需注意商店内同名产品，必要时加后缀                                                                                                                                            |
| 联系邮箱有效                               | ⬜ 待填         |                                                                                                                                                                                                     |
| 128×128 图标                               | ✅              | `public/icon/128.png`                                                                                                                                                                               |
| 至少 1 张 1280×800 截图                    | ⬜ **阻塞上架** | 必须先出图                                                                                                                                                                                          |
| 隐私政策 URL 可访问且与披露一致            | ⬜ **阻塞上架** | 必须先把 `PRIVACY.md` 挂到公开地址                                                                                                                                                                  |
| `chrome.storage.sync` 已披露               | ✅              | 见 Data Collection 例外 1                                                                                                                                                                           |
| 无远程代码 / 无混淆                        | ✅              | 全量打包，构建产物不含外链                                                                                                                                                                          |
| 实机功能验证（面板/弹窗/设置/右键/快捷键） | 🟡 待测         | 装已解压产物后逐项走查：面板列表 / 搜索 / 命令面板 / 设置页 / 右键菜单 / 地址栏 `t` 命令 / 4 条快捷键；SW 控制台应无 error，`chrome.action.getBadgeText()` 与 `chrome.commands.getAll()` 可直读校验 |
| 卸载干净                                   | ✅              | 仅本机存储，卸载即清除                                                                                                                                                                              |
