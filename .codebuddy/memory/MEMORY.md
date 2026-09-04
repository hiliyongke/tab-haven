# TabHaven 长期记忆

## 产品命名（2026-09-04 定版）
- **默认主题色 = 纯净 plain**（用户决策）：schema default、DEFAULT_SETTINGS、applyTheme 缺省、theme-init 回退均已对齐；改默认值只影响新装/未自定义主题用户。
- **产品名全面改为「Tabs」**（用户嫌「TabHaven（页港）」啰嗦，且明确要求代码里的关键字全部移除）：用户可见显示名 + **全部内部标识**（storage key `tabs.*`、导出格式 `tabs.export`、alarm 名 `tabs-auto-*`、日志前缀 `[Tabs]`、`data-tabs-tab-id` DOM 属性、事件名 `tabs:locate-*`、theme mirror `tabs:theme`、package.json name `tabs`、构建变量 `TABS_VARIANT`）均已完成替换。
- ⚠️ 存储键改名 = 重载扩展后旧本地数据（设置/固定空间/快照/撤销栈）读不到，等效一次数据重置；旧备份文件（`tabhaven.export` 格式）不再可导入。项目未发布、无外部用户，用户已知情接受。
- README/docs/PRIVACY/CHANGELOG 等文档仍写 TabHaven（页港），用户未要求改文档；如上架前需统一再处理。

## 用户协作偏好（稳定，务必遵守）
- **禁止自己编译/运行/杀进程**：用户本地一直自己跑 `pnpm dev`，我不得执行 `pnpm dev`、`pnpm build`、`pnpm test` 等会占用端口或干扰其运行环境的命令；也不得 kill wxt/vite 进程。只允许做代码/文件编辑（可用 typecheck/lint 做静态校验，但不要启动 dev server）。若用户环境异常，提示用户自行重启 `pnpm dev`。

## 用户设计偏好（稳定，务必遵守）

- **核心定位**：TabHaven 是「高效管理 tab」的工具，UI 的一切都要服务于效率与信息密度。
- **反感**：卡片式分组（白底+阴影+圆角盒子）显得丑且松散；低密度、大留白、信息稀疏的布局。
- **偏好**：
  - 分组用「扁平分隔线 + 彩色圆点 + 紧凑头部」代替卡片盒子，提升密度。
  - 搜索框必须**常驻顶部、输入即过滤**，拒绝「点按钮弹窗再输入」。
  - 固定标签用**图标磁贴**（像传统侧边栏钉图标），不要一行行铺开。
  - 激活标签自动滚入可视区；新建标签页固定底部。
  - 图标用 lucide-react，不要手绘 SVG。
  - 整体清新简约、紧凑高效。

## 项目设计决策（稳定，勿回退）
- 「最近访问」排序语义（2026-09-02 定版）：**打开新页面时一次性就位（新页面靠前），切换标签/页面加载不重排列表**。实现于 `src/core/tab-types.ts` 的 `mergeSnapshotTabs`（既有标签冻结 `lastAccessed`，新 id 才纳入实时时间戳）；后台休眠/复用合并读实时时间戳，不受冻结影响。改排序相关代码时不得重新引入「激活即重排」。
- 「同站点归并」语义（2026-09-04 定版）：修复「同一域名出现原生组 + 站点组两个分组」的碎片化。规则：① 展示层（`Sections.ts` 的 `collectSiteMergeCandidates`/`buildSitePlan`）把「域名命名的同站点原生组」（成员同 (注册域,子域) 且组标题===站点标签）并入站点分区展示，仅在分区已有同子域桶时吸收（不动聚合阈值/singles），自定义名组（如「工作」）绝不归并；② 决策层（`AutoGrouping.planAutoGroups` 的 `absorbIntoGroupId`）把同站点未分组标签吸收进既有组，收敛为每站点一个原生组；③ 吸收执行（`AutoGroupSync.syncAutoGroups`）不计入自动组记录（解散范围不变）。改分组相关代码时不得回退为「原生组与站点聚合完全割裂」的行为。

