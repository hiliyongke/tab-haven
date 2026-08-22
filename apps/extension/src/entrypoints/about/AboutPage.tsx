import { useTranslation } from '@/i18n';
import type { LucideIcon } from 'lucide-react';
import { getExtensionVersion } from '@/platform/navigation';
import { Icon, Icons } from '@/ui/common/Icon';
import { Kbd } from '@/ui/common/Kbd';

/**
 * 关于页：能力总览。
 *
 * 与设置页「能力发现清单」的分工：那份是**教学**（每项配「试用」按钮，指向侧边栏），
 * 这份是**说明**（完整罗列产品能力与入口，供评估与回顾）。
 *
 * 组织方式按「用户能做什么」而非「代码里有什么」：
 *  - 能力域：12 个域，每域 3-4 个具体能力点（标题 + 一句话说明）；
 *  - 快捷入口：把散落在右键菜单 / 地址栏 / 工具栏角标 / 命令面板的入口集中说明
 *    —— 否则这批能力只在一次性提示条与 README 里出现，用户在关于页找不到；
 *  - 快捷键：侧边栏内 + 浏览器级全局两组（全局那组可在浏览器扩展页自行修改）；
 *  - 隐私与数据、技术与验证：产品底线与实现事实。
 *
 * i18n 键一律写字面量：`i18n-kit check` 的孤立译文守卫靠「源码中出现原文」判定，
 * 模板拼接（`about.dom${id}Title`）会让整批译文被判为孤立。
 */

interface CapabilityGroup {
  icon: LucideIcon;
  titleKey: string;
  /** 能力点：标题 + 说明成对出现（双语下都比长句更易扫读）。 */
  items: { titleKey: string; bodyKey: string }[];
}

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    icon: Icons.layers,
    titleKey: '标签视图',
    items: [
      {
        titleKey: '原生标签组同步',
        bodyKey:
          '面板里的分组就是浏览器的原生标签组：折叠、改名、换色都会落到浏览器，两边始终一致。'
      },
      {
        titleKey: '同域名自动聚合',
        bodyKey: '同一域名的标签自动归到一起；可选把聚合结果同步为浏览器原生组（默认关闭）。'
      },
      {
        titleKey: '状态角标',
        bodyKey: '重复计数、静音 / 播放、分屏、休眠雪花直接标在行尾，不用逐个点开看。'
      }
    ]
  },
  {
    icon: Icons.folder,
    titleKey: '收藏夹',
    items: [
      {
        titleKey: '文件夹',
        bodyKey: '长期资产的归口：增删改、拖拽排序、一键打开全部、导出到浏览器书签。'
      },
      { titleKey: '常驻磁贴', bodyKey: '最常用的页面钉在顶部，一点直达；中键只关页面，不删磁贴。' },
      {
        titleKey: '挂起转正',
        bodyKey: '标签关闭后条目仍留在文件夹里，再次打开即重新绑定，收藏不会丢。'
      },
      {
        titleKey: '从书签栏导入',
        bodyKey: '把浏览器书签文件夹整批导入为收藏夹文件夹，迁移不用手工搬。'
      }
    ]
  },
  {
    icon: Icons.search,
    titleKey: '搜索与键盘流',
    items: [
      {
        titleKey: '三目标模糊搜索',
        bodyKey: '标题、网址、拼音首字母一起匹配（输入 zhw 也能命中「知乎网」）。'
      },
      {
        titleKey: '键盘导航',
        bodyKey: '↑↓ 漫游、Enter 激活、Esc 清除；命中片段高亮，结果一眼可辨。'
      },
      {
        titleKey: '跨窗口搜索',
        bodyKey: '打开后搜索覆盖所有窗口的标签，选中即切过去（默认只搜当前窗口）。'
      },
      {
        titleKey: '命令面板',
        bodyKey: '⌘P / Ctrl+P 一个入口搜命令与标签，直接执行「休眠全部」「存快照」「开设置」。'
      }
    ]
  },
  {
    icon: Icons.toNativeGroup,
    titleKey: '上下文与暂存',
    items: [
      {
        titleKey: '工作区切换',
        bodyKey:
          '把当前窗口现场存为一个工作区，顶部 chip 一键切换：切走前先写回原工作区现场，误切可 ⌘Z 找回。'
      },
      {
        titleKey: '其他窗口分段',
        bodyKey:
          '面板底部按窗口列出其他窗口的标签：点击一行直接跳过去（自动聚焦该窗口），也可就地关闭。'
      }
    ]
  },
  {
    icon: Icons.grip,
    titleKey: '拖拽整理',
    items: [
      {
        titleKey: '四处可拖',
        bodyKey: '标签、常驻磁贴、分组头、文件夹条目都支持拖拽排序，各处整理方式保持一致。'
      },
      {
        titleKey: '拖入即归类',
        bodyKey: '拖进收藏夹或文件夹即完成归档；重复网址自动去重，不会存两份。'
      },
      {
        titleKey: '键盘拖拽',
        bodyKey: '空格键起拖、方向键移动、再按空格放下，全键盘也能完成整理。'
      }
    ]
  },
  {
    icon: Icons.copyX,
    titleKey: '重复治理',
    items: [
      {
        titleKey: '一键清理',
        bodyKey: '每个网址保留激活 / 固定 / 位置靠前的一个；固定标签与收藏夹条目豁免，清理可撤销。'
      },
      {
        titleKey: '自动合并',
        bodyKey: '新打开与已有标签同址时自动合并，避免越开越多（可关闭，可设提示）。'
      },
      {
        titleKey: '重复角标',
        bodyKey: '行尾「n×」直接标出重复，底栏出现「清理重复」入口并显示待清理数量。'
      }
    ]
  },
  {
    icon: Icons.shield,
    titleKey: '撤销安全网',
    items: [
      {
        titleKey: '多层撤销',
        bodyKey: '经 Tabs 执行的关闭都可撤销（次数可在设置中调整），一次误操作一键反悔。'
      },
      {
        titleKey: '撤销历史',
        bodyKey: '任意批次随时恢复；自动行为标注来源（手动关闭 / 窗口归档），不会匿名发生。'
      },
      {
        titleKey: '接住浏览器最近关闭',
        bodyKey: '连浏览器自己关掉的标签也能找回；恢复失败的条目留在历史里可重试。'
      }
    ]
  },
  {
    icon: Icons.snapshot,
    titleKey: '快照',
    items: [
      {
        titleKey: '四种保存方式',
        bodyKey: '命名保存当前窗口、归档（保存并关闭）、保存收藏夹、粘贴 OneTab 文本导入。'
      },
      {
        titleKey: '关窗自动快照',
        bodyKey: '默认开启、滚动保留最近若干份；崩溃或强制退出也能保住现场。'
      },
      {
        titleKey: '精确恢复',
        bodyKey: '只新建缺失的标签，并还原固定、静音与分组状态，不会把已开着的再开一遍。'
      },
      {
        titleKey: '本地周报',
        bodyKey: '快照 / 归档标签的本地聚合统计，纯本地计算，不涉及网络与账号。'
      }
    ]
  },
  {
    icon: Icons.snowflake,
    titleKey: '休眠与资源',
    items: [
      {
        titleKey: '三种休眠方式',
        bodyKey: '手动单个、批量休眠后台标签、定时自动休眠；自动休眠可撤销，并支持域名白名单。'
      },
      { titleKey: '一键唤醒', bodyKey: '底栏一键唤醒全部休眠标签，回来时状态原样。' },
      {
        titleKey: '系统通知',
        bodyKey: '自动休眠完成时可选系统通知；无论是否通知，侧边栏内始终可撤销。'
      }
    ]
  },
  {
    icon: Icons.bookmarkAdd,
    titleKey: '数据与同步',
    items: [
      {
        titleKey: '完整备份',
        bodyKey: '收藏夹 + 设置 + 全部快照与归档导出为单个 JSON；导入是事务，失败整体回滚。'
      },
      {
        titleKey: '浏览器账号通道镜像',
        bodyKey: '文件夹、常驻磁贴与设置可经你自己的浏览器账号跨设备同步，不经 Tabs 的服务器。'
      },
      {
        titleKey: '坏数据隔离',
        bodyKey: '所有持久化数据都过 schema 校验，损坏条目被隔离，既不静默丢弃也不扩散。'
      },
      {
        titleKey: '诊断导出',
        bodyKey: '本地记录技术日志（不含标签标题与网址），遇到问题时导出一份便于定位。'
      }
    ]
  },
  {
    icon: Icons.infoAlert,
    titleKey: '开发者工具',
    items: [
      {
        titleKey: '指定站点禁用缓存',
        bodyKey: '命中规则的站点响应头强制 no-store（含子资源），等效 DevTools 勾选 Disable cache。'
      },
      {
        titleKey: '三种规则格式',
        bodyKey: '域名 / 域名+路径 / 完整 URL 前缀，最多 50 条，按行维护。'
      },
      { titleKey: '命中角标', bodyKey: '命中标签在侧边栏显示「禁」角标，一眼看出生效范围。' },
      {
        titleKey: '按需授权',
        bodyKey: '网站访问权限走可选申请：不开这个功能，安装时就不会出现全站权限警告。'
      }
    ]
  },
  {
    icon: Icons.settings,
    titleKey: '外观与平台',
    items: [
      { titleKey: '中英双语', bodyKey: '界面文案完整双语，跟随浏览器语言自动切换。' },
      {
        titleKey: '主题三态 + 多套配色',
        bodyKey: '跟随系统 / 亮 / 暗三态，另有 5 套配色可选，切换带平滑过渡。'
      },
      { titleKey: '三档密度', bodyKey: '紧凑 / 宽松 / 大字号，长列表与低视力场景都照顾到。' },
      {
        titleKey: '自制弹窗与快捷键帮助',
        bodyKey: '不依赖浏览器原生弹窗；设置页有完整快捷键表，并可跳转浏览器扩展快捷键设置。'
      }
    ]
  }
];

/**
 * 快捷入口：能力本身的「怎么触发」。
 * 只写在一次性提示条（tips.discover）与 README 里时，用户关掉提示后就没有地方
 * 能查到「右键菜单有哪些动作」「地址栏命令是什么」。
 */
const ENTRY_POINTS: { icon: LucideIcon; titleKey: string; bodyKey: string }[] = [
  {
    icon: Icons.menu,
    titleKey: '右键菜单',
    bodyKey:
      '页面、链接、标签栏、工具栏图标四个上下文：休眠、固定、按域名搜索、加入文件夹、打开面板与设置。'
  },
  {
    icon: Icons.search,
    titleKey: '地址栏命令',
    bodyKey: '地址栏输入 t 再按 Tab，然后输关键词，直达标签、固定条目与文件夹。'
  },
  {
    icon: Icons.sparkles,
    titleKey: '工具栏角标',
    bodyKey: '角标可显示标签数、重复组数或休眠数，四档可调（自动 / 标签数 / 重复组数 / 关闭）。'
  },
  {
    icon: Icons.shortcuts,
    titleKey: '命令面板',
    bodyKey: '⌘P（Ctrl+P）一个入口：搜命令、搜标签，直接执行动作。'
  },
  {
    icon: Icons.pin,
    titleKey: '常驻磁贴与收藏夹',
    bodyKey: '把常用页面拖到顶部磁贴，或拖进收藏夹的文件夹，随时一键直达。'
  }
];

/**
 * 侧边栏内快捷键（焦点在侧边栏时生效）。
 *
 * `labelKey` 是**中文原文常量**（渲染时统一过 `t()`）。属性名以 `Key` 结尾是
 * 扫描器的抽取约定：常量表不是调用点，只有 `*Key` 属性会被抽进词典——
 * 用 `@i18n-ignore` 豁免 zh-linter 只会压住告警，词条照样进不了词典
 * （英文模式露中文，而 scan / check 双绿）。
 */
const PANEL_SHORTCUTS: { labelKey: string; keys: string[] }[] = [
  { labelKey: '聚焦搜索', keys: ['⌘/Ctrl', 'K'] },
  { labelKey: '打开命令面板', keys: ['⌘/Ctrl', 'P'] },
  { labelKey: '定位当前标签', keys: ['⌘/Ctrl', 'J'] },
  { labelKey: '撤销最近关闭', keys: ['⌘/Ctrl', 'Z'] },
  { labelKey: '重做最近一次撤销（再次关闭刚恢复的标签）', keys: ['⌘/Ctrl', '⇧', 'Z'] },
  { labelKey: '在列表中漫游 / 激活', keys: ['↑', '↓', 'Enter'] },
  { labelKey: '重排当前标签', keys: ['Alt', '↑/↓'] },
  { labelKey: '键盘拖拽', keys: ['Space'] }
];

/**
 * 浏览器级全局快捷键（在任意页面生效）。
 * 与侧边栏内快捷键分开列：这组可以在浏览器扩展快捷键页自行修改，
 * 写死默认值会让改了键的用户以为产品文档是错的。
 */
const GLOBAL_SHORTCUTS: { labelKey: string; keys: string[] }[] = [
  { labelKey: '聚焦搜索', keys: ['Ctrl', 'Shift', 'F'] },
  { labelKey: '打开 / 聚焦侧边栏', keys: ['Ctrl', 'Shift', 'O'] },
  { labelKey: '定位当前标签', keys: ['Ctrl', 'Shift', 'L'] },
  { labelKey: '休眠后台标签', keys: ['Ctrl', 'Shift', 'U'] }
];

/**
 * 隐私承诺：产品宪法级底线，置于 Hero 之下最显眼处（原文常量，渲染时过 t()）。
 * 同样走 `*Key` 属性以便扫描器抽词：这四条是最不该在英文模式露中文的文案。
 */
const PRIVACY_BADGES: { labelKey: string }[] = [
  { labelKey: '数据只在本机' },
  { labelKey: '无账号' },
  { labelKey: '无遥测' },
  { labelKey: '零网络请求' }
];

/** 隐私与数据事实（含权限口径，避免用户对「为什么需要这些权限」产生疑虑）。 */
const PRIVACY_FACTS: { titleKey: string; bodyKey: string }[] = [
  {
    titleKey: '本地优先存储',
    bodyKey: '主存储是浏览器本地存储（chrome.storage.local）；无自有服务器、无账号、无云端。'
  },
  {
    titleKey: '零出站网络请求',
    bodyKey: '扩展本身不发起任何网络请求，这一点由构建期的隐私回归检查把关。'
  },
  {
    titleKey: '同步走浏览器通道',
    bodyKey: '跨设备镜像经你自己的浏览器账号通道完成，Tabs 不参与、也看不到内容。'
  },
  {
    titleKey: '权限最小化',
    bodyKey: '权限清单冻结在构建配置与隐私说明中，新增任何权限都必须先改这两处。'
  },
  {
    titleKey: '不收集浏览内容',
    bodyKey: '诊断日志只记录技术上下文（时间、模块、错误），不含标签标题与网址。'
  }
];

/**
 * 权限 → 用途映射（信任面板）：让用户可自行验证「零网络」这一承诺。
 * 键一律字面量：死键守卫靠「源码中出现精确键串」判定，模板拼接会让整批键被判死键。
 * 数据源：`wxt.config.ts` 的 permissions（12 项，sidePanel 已显式声明而非由框架
 * 自动追加）+ optional_host_permissions 的全站 host 权限。
 * privacy-check 校验权限清单与 PRIVACY.md 一致，本面板只做展示，不引入任何监测代码。
 */
const PERMISSION_FACTS: { titleKey: string; bodyKey: string }[] = [
  {
    titleKey: 'tabs — 读取标签列表',
    bodyKey: '读取标签的标题、网址与状态，用于列表展示、分组、搜索与快照。不读取页面内容。'
  },
  {
    titleKey: 'tabGroups — 管理原生标签组',
    bodyKey: '把侧边栏中的分组同步为浏览器原生标签组（可选功能），或恢复快照时重建分组。'
  },
  {
    titleKey: 'storage — 本地存储',
    bodyKey: '把设置、快照与收藏夹存进浏览器本地存储（chrome.storage.local）。数据不出本机。'
  },
  { titleKey: 'alarms — 定时器', bodyKey: '驱动定时自动快照与自动休眠的周期任务，不联网。' },
  {
    titleKey: 'contextMenus — 右键菜单',
    bodyKey: '在页面 / 链接 / 标签栏右键中提供休眠、固定、按域名搜索等入口。'
  },
  {
    titleKey: 'omnibox — 地址栏命令',
    bodyKey: '支持在地址栏输入 t 前缀直达标签搜索，不发起网络请求。'
  },
  {
    titleKey: 'sessions — 浏览器会话',
    bodyKey: '读取浏览器自己的「最近关闭」记录，用于接住误关的标签与窗口。'
  },
  {
    titleKey: 'bookmarks — 书签读写',
    bodyKey: '把收藏夹文件夹导出到浏览器书签，或从书签栏整批导入。仅在触发相应功能时使用。'
  },
  { titleKey: 'notifications — 系统通知', bodyKey: '自动休眠完成时发出可选的系统通知。可关闭。' },
  {
    titleKey: 'favicon — 站点图标',
    bodyKey: '站点图标取自浏览器自己的本地图标库，不会向你访问的站点发起任何请求。'
  },
  {
    titleKey: 'declarativeNetRequest — 响应头改写',
    bodyKey: '仅开发者功能「指定站点禁用缓存」使用：为命中站点改写响应头。不开启该功能则不生效。'
  },
  {
    titleKey: 'sidePanel — 侧边栏',
    bodyKey: 'Tabs 的主界面形态：浏览器侧边栏。已在扩展配置中声明。'
  },
  {
    titleKey: '可选的网站访问权限',
    bodyKey:
      '仅「指定站点禁用缓存」按需申请（可选权限）：不开该功能，安装时不会出现全站访问警告。其余功能不需要任何网站访问权限。'
  }
];

/** 信任面板补充事实：数据存放位置 + 自行验证教程（不要求信任声明，教会用户验证）。 */
const TRUST_EXTRA_FACTS: { titleKey: string; bodyKey: string }[] = [
  {
    titleKey: '数据存放位置',
    bodyKey:
      '设置、快照、收藏夹全部存于浏览器本地存储；跨设备镜像（默认关闭）走你自己的浏览器账号同步通道，Tabs 无服务器、看不到内容。'
  },
  {
    titleKey: '自行验证零网络',
    bodyKey:
      '打开浏览器开发者工具（F12）→ Network（网络）面板 → 勾选 Preserve log（保留日志）→ 正常使用 Tabs 各功能。你不会看到任何由 Tabs 发起的出站请求。另有构建期隐私检查持续验证这一点。'
  }
];

/**
 * 技术与验证。
 *
 * 本区块刻意**不写许可**：项目暂不开源，写「MIT 开源」等于承诺一件没有的事，
 * 也会与官网（页脚、首屏徽章、结尾 CTA 均已移除许可行）口径打架。
 * 这里改成一条同样可核验、而且用户可以自己动手验证的承诺。
 */
const TECH_FACTS: { titleKey: string; bodyKey: string }[] = [
  { titleKey: '技术栈', bodyKey: 'WXT + React 19 + TypeScript + Tailwind CSS + zustand + zod。' },
  {
    titleKey: '测试与门禁',
    bodyKey: 'Vitest 行为规格 + UI 渲染基线 + 设计令牌守卫 + 隐私回归，共 800 余条用例。'
  },
  {
    titleKey: '可自行验证',
    bodyKey: '零出站网络请求不必听我们说：打开 DevTools 的 Network 面板观察扩展上下文，请求数为零。'
  }
];

/** 区块标题样式统一（避免五处各写一遍）。 */
const SECTION_TITLE_CLASS = 'mb-3 text-sm font-semibold tracking-wide text-gray-600';
// rounded-lg（8px）与设置页卡片同档，避免跨页两套圆角。
const CARD_CLASS = 'rounded-lg border border-gray-200 bg-surface p-4 transition-base';

export function AboutPage() {
  const { t } = useTranslation();
  const version = getExtensionVersion();

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      {/* Hero：品牌 + 定位 + 版本 + 隐私承诺 */}
      <header className="flex flex-col items-start gap-3">
        {/* 明暗两版 logo 由 CSS 按 data-theme 切换（见 main.css .about-logo-*） */}
        <img src="/icon/logo-light.svg" alt="" className="about-logo-light h-12 w-12" />
        <img src="/icon/logo.svg" alt="" className="about-logo-dark h-12 w-12" />
        <div>
          {/* 产品名不翻译：不含汉字，走「语义 key 直通」分支，两种语言都显示 Tabs。 */}
          {/* 与设置页 h1 同为 text-lg：两个 Chrome 扩展内页面是同级入口，
              一级标题字号不同会让跨页跳转时页面「重量感」突变。 */}
          <h1 className="text-lg font-semibold text-gray-900">{t('Tabs')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('本地优先、无账号、无云端的标签工作台')}</p>
        </div>
        {version && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-3xs text-gray-500">
            {t('版本 {{version}}', { version })}
          </span>
        )}
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {PRIVACY_BADGES.map((badge) => (
            <li
              key={badge.labelKey}
              className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-3xs font-medium text-accent-700"
            >
              <Icon d={Icons.check} className="h-3 w-3" />
              {t(badge.labelKey)}
            </li>
          ))}
        </ul>
      </header>

      {/* 能力总览：域 → 能力点 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('全部能力')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAPABILITY_GROUPS.map((group) => (
            <article key={group.titleKey} className={CARD_CLASS + ' hover:border-accent-300'}>
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600">
                  <Icon d={group.icon} className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-sm font-semibold text-gray-800">{t(group.titleKey)}</h3>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {group.items.map((item) => (
                  <li key={item.titleKey} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-400"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700">{t(item.titleKey)}</p>
                      <p className="mt-0.5 text-3xs leading-relaxed text-gray-500">
                        {t(item.bodyKey)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* 快捷入口：这些能力散落在浏览器各处，集中说明「在哪里触发」 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('快捷入口')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {ENTRY_POINTS.map((entry) => (
            <article key={entry.titleKey} className={CARD_CLASS}>
              <div className="flex items-start gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-600">
                  <Icon d={entry.icon} className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-gray-800">{t(entry.titleKey)}</h3>
                  <p className="mt-1 text-3xs leading-relaxed text-gray-500">{t(entry.bodyKey)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 键盘快捷键：侧边栏内 + 浏览器级全局 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('键盘快捷键')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* 双卡上下留白改由卡片自身 py-3 承担（原靠内部小标题的 pt-3 凑，
              导致左卡底部只剩 li 的 10px、右卡另有 pb-3 共 12px，两边差 2px） */}
          <div className="rounded-lg border border-gray-200 bg-surface px-4 py-3">
            {/* 11px/500 而非 10px/600：层级应是 14/600 → 12/500 → 11/500 单调递减，
                最小一级字重回弹到 600 会比上一级还重，且 10px 低于 11px 下限。 */}
            <p className="pb-1 text-3xs font-medium tracking-wide text-gray-500">{t('侧边栏内')}</p>
            <ul className="divide-y divide-gray-100">
              {PANEL_SHORTCUTS.map((shortcut) => (
                <li
                  key={shortcut.labelKey}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <span className="text-xs text-gray-700">{t(shortcut.labelKey)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-gray-200 bg-surface px-4 py-3">
            <p className="pb-1 text-3xs font-medium tracking-wide text-gray-500">
              {t('浏览器级（全局）')}
            </p>
            <ul className="divide-y divide-gray-100">
              {GLOBAL_SHORTCUTS.map((shortcut) => (
                <li
                  key={shortcut.labelKey}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <span className="text-xs text-gray-700">{t(shortcut.labelKey)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-3xs leading-relaxed text-gray-500">
              {t('这组快捷键可在浏览器的扩展快捷键设置页自行修改。')}
            </p>
          </div>
        </div>
      </section>

      {/* 隐私与数据 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('隐私与数据')}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PRIVACY_FACTS.map((fact) => (
            <li key={fact.titleKey} className={CARD_CLASS}>
              <p className="text-xs font-medium text-gray-700">{t(fact.titleKey)}</p>
              <p className="mt-1 text-3xs leading-relaxed text-gray-500">{t(fact.bodyKey)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 信任面板：权限 → 用途映射 + 数据位置 + 自行验证教程 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('权限与用途')}</h2>
        {/* max-w-[65ch]：容器 896px 下 11px 字号单行约 77 个汉字，远超舒适阅读宽度 */}
        <p className="mb-3 max-w-[65ch] text-3xs leading-relaxed text-gray-500">
          {t(
            '以下是本扩展声明的全部权限与各自的一句话用途。权限清单冻结在构建配置中，新增任何权限都会使构建失败。'
          )}
        </p>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-surface">
          <ul className="divide-y divide-gray-100">
            {PERMISSION_FACTS.map((fact) => (
              <li key={fact.titleKey} className="flex flex-col gap-0.5 px-4 py-3">
                <p className="text-xs font-medium text-gray-700">{t(fact.titleKey)}</p>
                <p className="text-3xs leading-relaxed text-gray-500">{t(fact.bodyKey)}</p>
              </li>
            ))}
          </ul>
        </div>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {TRUST_EXTRA_FACTS.map((fact) => (
            <li key={fact.titleKey} className={CARD_CLASS}>
              <p className="text-xs font-medium text-gray-700">{t(fact.titleKey)}</p>
              <p className="mt-1 text-3xs leading-relaxed text-gray-500">{t(fact.bodyKey)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 技术与验证 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('技术与验证')}</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {TECH_FACTS.map((fact) => (
            <li key={fact.titleKey} className={CARD_CLASS}>
              <p className="text-xs font-medium text-gray-700">{t(fact.titleKey)}</p>
              <p className="mt-1 text-3xs leading-relaxed text-gray-500">{t(fact.bodyKey)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 页脚 */}
      <footer className="mt-10 border-t border-gray-200 pt-4">
        <p className="max-w-[65ch] text-3xs leading-relaxed text-gray-500">
          {t('无自有服务器 · 无账号 · 无遥测 · 零出站网络请求；数据默认只存在于你的浏览器里。')}
        </p>
      </footer>
    </div>
  );
}
