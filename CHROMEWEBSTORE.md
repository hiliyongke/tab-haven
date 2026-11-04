# Chrome Web Store Listing — Tabs

> 本文件维护 Chrome Web Store 文案与发布资料；涉及权限或数据披露时，以 `PRIVACY.md` 与 `wxt.config.ts` 的实际定义为准并保持同步。

## Store Listing

**Extension Name** `Tabs`
<!-- 与 manifest 的 __MSG_extName__ 一致（`public/_locales/*/messages.json`），75 字符内。 -->

**Short Description**（132 字符内）

> Organize, search, and recover your tabs from a local side panel — grouped by site, saved in folders, always undoable.

中文（商店本地化文案）：

> 把散乱的标签整理成一个本地侧边栏：按站点聚合、收进文件夹、关错了也能一键找回。

**Detailed Description**

> Tabs turns a crowded browser window into an orderly workspace — and makes sure you can always find your way back.
>
> Tabs runs locally: there is no account to create, no sign-in, and no server of its own. It contains no analytics or tracking. The extension code initiates no network requests. If you enable browser account sync, selected data may leave the device through the browser vendor's sync channel, as described below.
>
> Group tabs by site automatically, or drag them into Fixed space. Pin the pages you always come back to. Search by title, address, or even pinyin initials and jump straight to a tab. Close a batch by accident? Undo it — repeatedly. Save the whole window as a snapshot before you shut down, and restore only what you actually need later. Hibernate tabs you are not using to free up memory, then wake them all with one click. Clean up duplicates in one pass, keeping the tab you were actually using.
>
> Open the panel from the toolbar icon, a keyboard shortcut, the right-click menu, or by typing `t` in the address bar. Drag to reorder anything. Everything is keyboard-navigable, and the interface ships in English and Simplified Chinese with light, dark, and system themes.
>
> Your data stays in your browser's own local storage. If you turn on the optional cross-device switch, your folders, always-on tiles, and settings are mirrored through your own browser account's sync — Tabs never operates that channel and never sees the data. It is off by default, and turning it off deletes the mirror. This is a browser-vendor sync channel rather than a network request initiated by Tabs. You can export everything to a JSON file at any time, and uninstalling removes all local data.
>
> Site icons shown next to tabs come from your browser's own local icon store — Tabs makes no request to the sites you visit. The extension code initiates no outbound network requests.
>
> Free forever, with no ads and no upsells. General questions and bugs: open an issue at the project repository. For suspected security vulnerabilities, use the private Security Advisories channel described in SECURITY.md instead of a public issue.

**Category** `Productivity`

**Single Purpose**

> Organize, search, and recover your browser tabs from a side panel.

**Primary Language** `English`（界面同时提供简体中文）

## Graphics & Assets

| Asset                          | Requirement         | Suggested content                    |
| ------------------------------ | ------------------- | ------------------------------------ |
| Store Icon [REQUIRED]          | 128×128 PNG         | Extension icon                       |
| Screenshot [REQUIRED]          | 1280×800 或 640×400 | 侧边栏标签列表与站点聚合分组         |
| Screenshot [RECOMMENDED]       | 同上                | 搜索、收藏夹、撤销历史或权限说明界面 |
| Small Promo Tile [RECOMMENDED] | 440×280             | 产品主视觉                           |
| Marquee Promo Tile             | 1400×560            | 产品主视觉                           |

### Screenshot Notes

- 截图必须是**当前发布构建 UI 的真实画面**，不要放手机/平板外壳（本扩展只在桌面浏览器侧边栏运行）。
- 截图里出现的网址建议用示例站点，避免暴露真实浏览记录。
- 至少 1 张需包含侧边栏在真实浏览器窗口中的形态（能看出是侧边栏，而非独立网页）。

## Permissions Justification

来源：`wxt.config.ts` 中的权限定义，并与 `PRIVACY.md` 第 2 节**逐项一致**。下表为面向商店审核的对应说明；权限变更时同步更新两处。

| Permission              | Type                      | Justification（面向审核团队，填 dashboard 用）                                                                                                                                                                                              |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`                  | permissions               | 在侧边栏里列出并管理你当前窗口的标签：显示标题、地址、图标与固定/静音状态，并支持切换、关闭、休眠、排序。工具栏角标与地址栏建议会在本机读取所有普通窗口的标签元数据用于统计与搜索（不存储、不外发）。不读取浏览器历史记录，数据只留在本机。 |
| `tabGroups`             | permissions               | 识别并同步 Chrome 原生标签组：把同域名标签聚合后可选「同步为原生标签组」，解散时只清理本扩展创建的组。                                                                                                                                      |
| `storage`               | permissions               | 把你创建的文件夹、常驻磁贴、快照与设置保存在本机浏览器存储中；离线可用，卸载即清除。                                                                                                                                                        |
| `alarms`                | permissions               | 仅在你开启「自动休眠」或「定时自动快照」后，按周期检查标签状态（MV3 后台会被回收，闹钟是唯一可靠的调度方式）。自动休眠默认关闭；定时自动快照默认开启（可关闭）。                                                                            |
| `contextMenus`          | permissions               | 在网页、链接、标签栏与工具栏图标的右键菜单里提供「休眠 / 固定 / 加入文件夹 / 按域名搜索 / 打开面板」快捷操作。                                                                                                                              |
| `omnibox`               | permissions               | 让你在地址栏输入 `t` 加关键词，直接搜索已打开的标签、固定条目与文件夹并回车打开。                                                                                                                                                           |
| `sessions`              | permissions               | 在撤销历史面板中显示浏览器最近关闭的标签与窗口，供你一键恢复（浏览器自身的会话数据，本扩展不保存）。                                                                                                                                        |
| `bookmarks`             | permissions               | 仅在**你主动点击**时使用：把固定文件夹导出为书签，或从书签栏导入为固定文件夹。不会在后台读取书签。                                                                                                                                          |
| `notifications`         | permissions               | 执行自动休眠或后台动作后，在本机弹出一次系统通知告知结果（通知内容仅为本机文案）。                                                                                                                                                          |
| `favicon`               | permissions               | 读取浏览器自己的本地站点图标库来显示标签旁的站点图标。Tabs 不向你访问的站点发起任何请求（图标不经第三方）。                                                                                                                                 |
| `sidePanel`             | permissions               | 在浏览器侧边栏中展示主界面（这是本扩展的默认形态）。                                                                                                                                                                                        |
| `declarativeNetRequest` | permissions               | 供可选的开发者功能「指定站点禁缓存」：按你填写的站点改写该站点响应的缓存头。**不拦截请求、不读取页面内容、不上传任何数据。**                                                                                                                |
| `<all_urls>`            | optional_host_permissions | **默认不授予**。仅当你主动开启「禁缓存」开关时由浏览器弹窗询问，用于让上一条的响应头改写在你指定的站点上生效；拒绝则该功能保持关闭，可随时在扩展详情页收回。                                                                                |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** **No**（Tabs 无自有服务器、无账号、无遥测。）

| Data Type                    | Collected?   | Transmitted Off-Device? | Purpose                                | Shared with Third Parties? |
| ---------------------------- | ------------ | ----------------------- | -------------------------------------- | -------------------------- |
| Personally identifiable info | No           | No                      | —                                      | No                         |
| Health info                  | No           | No                      | —                                      | No                         |
| Financial info               | No           | No                      | —                                      | No                         |
| Authentication info          | No           | No                      | —                                      | No                         |
| Personal communications      | No           | No                      | —                                      | No                         |
| Location                     | No           | No                      | —                                      | No                         |
| Web history                  | **本地处理** | No                      | 在侧边栏展示与组织当前窗口标签         | No                         |
| User activity                | **本地处理** | 否                      | 撤销栈 / 快照 / 习惯洞察（纯本地计算） | No                         |
| Website content              | No           | No                      | —                                      | No                         |

**必须在披露表单里如实申报的浏览器账号同步**（不申报 = 口径不一致 = 拒审风险）：

1. **跨设备同步镜像（默认关闭）**：开启后文件夹、常驻磁贴与设置会经 `chrome.storage.sync` 通过用户自己的浏览器账号通道同步 —— 这在 CWS 口径下属于**离设备传输**，必须勾选并说明：「默认关闭，仅传输用户主动固定的条目与设置，Tabs 不经手」。这是浏览器厂商同步通道，不是 Tabs 主动发起的出站网络请求。

> 站点图标取自浏览器本地图标库（`favicon` 权限），Tabs 不向被浏览站点发起任何请求。产品对外口径统一为「扩展代码不主动发起网络请求；用户开启浏览器账号同步后，浏览器厂商同步通道可能离设备传输数据」。

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**：发布清单字段；使用公开可访问的正式地址。

发布前确保隐私政策可公开访问，且内容与上方的数据披露及根目录 `PRIVACY.md` 一致；不要填写占位 URL。

## Distribution

**Visibility**：Public
**Regions**：All regions

## Developer Info

以下字段由维护者在发布清单中填写并核验，不在此文件保存真实身份或联系信息：

| 字段                         | 要求        | 发布前核验                                        |
| ---------------------------- | ----------- | ------------------------------------------------- |
| Publisher Name               | REQUIRED    | 与商店开发者账号显示名称一致                      |
| Contact Email                | REQUIRED    | 可接收商店审核与用户通知                          |
| Support URL                  | RECOMMENDED | 页面可访问，且提供一般产品问题反馈入口            |
| Homepage URL                 | RECOMMENDED | 页面可访问，且与 `TABS_SITE_URL` 发布域名一致     |
| Privacy Policy URL           | REQUIRED    | 公开可访问，且与上方数据披露及 `PRIVACY.md` 一致  |
| Security Advisory / 联系入口 | REQUIRED    | 按 `SECURITY.md` 使用私有报告入口，不公开漏洞细节 |

## Version History

| Version | Date       | Changes                                                                                                                                        |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | 2026-10-13 | 首个正式版本：侧边栏标签组织、站点聚合、收藏夹、模糊搜索与键盘流、拖拽排序、多层撤销、快照与归档、重复治理、习惯洞察、休眠与资源、备份导入导出 |

## 发布前自查（Pre-Publish Checklist）

| 检查项             | 发布前确认内容                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifest           | 使用 Manifest V3，名称、版本和描述与商店资料一致                                                                                                                                           |
| 版本号             | 高于商店中已发布的版本                                                                                                                                                                     |
| 权限               | 权限最小化，每项用途均有明确说明；主机权限的授予方式与实际行为一致                                                                                                                         |
| 商店素材           | 图标、至少一张符合尺寸要求的截图及其他所需素材均已准备                                                                                                                                     |
| 隐私政策与数据披露 | 隐私政策可公开访问，且与商店数据披露及 `PRIVACY.md` 一致                                                                                                                                   |
| 同步披露           | 如实说明 `chrome.storage.sync` 镜像的范围、默认状态与浏览器账号通道                                                                                                                        |
| 安全               | ZIP 不含开发文件；扩展不包含远程代码或混淆代码                                                                                                                                             |
| 构建与功能         | 检查发布构建，并验证侧边栏、搜索、设置、右键菜单、快捷键及地址栏命令                                                                                                                       |
| 联系方式           | 发布者名称、联系邮箱及支持入口准确且可用                                                                                                                                                   |
| 发布清单字段       | Publisher Name、Contact Email、Support URL、Homepage URL、Privacy Policy URL 均已填写真实可用值，无占位符                                                                                  |
| 版本历史           | 新版本登记版本号、日期与实际变更，并与 CHANGELOG、manifest 和 tag 一致                                                                                                                     |
| 删除与备份         | 确认导出备份与卸载清除行为符合隐私说明                                                                                                                                                     |
| 文案与单一用途     | 描述准确、无夸大，并清楚表达标签与会话组织和恢复这一用途                                                                                                                                   |
| 目标浏览器实测     | 在 Chrome 114、Chrome 当前稳定版、Edge 与 Brave 实机验证 `sidePanel.open()`、`setPanelBehavior()`、`favicon` / `_favicon/`、`tabs.group`、`storage.sync`、右键菜单与快捷键；记录版本与结果 |
| forced-colors 实测 | 在 Windows 高对比度模式验证官网与扩展的关键状态、焦点环、CTA 对比度和拖拽反馈                                                                                                              |
| 供应链固定         | 用 `git ls-remote` 核对 CI / Release 使用的每个 GitHub Action tag 对应 commit SHA，固定 SHA 并记录核验日期；无法联网核实时不得发布                                                         |
| 安全入口可达性     | 以维护者与普通用户身份点击 `SECURITY.md` 的 Advisories 绝对链接，确认可进入私有报告入口                                                                                                    |
