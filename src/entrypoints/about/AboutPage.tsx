import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { getExtensionVersion } from '@/platform/navigation';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 关于页：能力总览。
 *
 * 与设置页「能力发现清单」的分工：那份是**教学**（每项配「试用」按钮，指向侧边栏），
 * 这份是**说明**（完整罗列产品能力与入口，供评估与回顾）。
 *
 * 组织方式按「用户能做什么」而非「代码里有什么」：
 *  - 能力域：11 个域，每域 3-4 个具体能力点（标题 + 一句话说明）；
 *  - 快捷入口：把散落在右键菜单 / 地址栏 / 工具栏角标 / 命令面板的入口集中说明
 *    —— 这批能力此前只出现在一次性提示条与 README 里，用户在关于页根本找不到；
 *  - 快捷键：面板内 + 浏览器级全局两组（全局那组可在浏览器扩展页自行修改）；
 *  - 隐私与数据、技术与许可：产品底线与实现事实。
 *
 * i18n 键一律写字面量：死键守卫靠「源码中出现精确键串」判定，模板拼接
 * （`about.dom${id}Title`）会让整批键被判死键（见 scripts/i18n-dead-keys.mjs）。
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
    titleKey: 'about.domTabsTitle',
    items: [
      { titleKey: 'about.domTabs1Title', bodyKey: 'about.domTabs1Body' },
      { titleKey: 'about.domTabs2Title', bodyKey: 'about.domTabs2Body' },
      { titleKey: 'about.domTabs3Title', bodyKey: 'about.domTabs3Body' }
    ]
  },
  {
    icon: Icons.folder,
    titleKey: 'about.domFixedTitle',
    items: [
      { titleKey: 'about.domFixed1Title', bodyKey: 'about.domFixed1Body' },
      { titleKey: 'about.domFixed2Title', bodyKey: 'about.domFixed2Body' },
      { titleKey: 'about.domFixed3Title', bodyKey: 'about.domFixed3Body' },
      { titleKey: 'about.domFixed4Title', bodyKey: 'about.domFixed4Body' }
    ]
  },
  {
    icon: Icons.search,
    titleKey: 'about.domSearchTitle',
    items: [
      { titleKey: 'about.domSearch1Title', bodyKey: 'about.domSearch1Body' },
      { titleKey: 'about.domSearch2Title', bodyKey: 'about.domSearch2Body' },
      { titleKey: 'about.domSearch3Title', bodyKey: 'about.domSearch3Body' },
      { titleKey: 'about.domSearch4Title', bodyKey: 'about.domSearch4Body' }
    ]
  },
  {
    icon: Icons.grip,
    titleKey: 'about.domDragTitle',
    items: [
      { titleKey: 'about.domDrag1Title', bodyKey: 'about.domDrag1Body' },
      { titleKey: 'about.domDrag2Title', bodyKey: 'about.domDrag2Body' },
      { titleKey: 'about.domDrag3Title', bodyKey: 'about.domDrag3Body' }
    ]
  },
  {
    icon: Icons.copyX,
    titleKey: 'about.domDupTitle',
    items: [
      { titleKey: 'about.domDup1Title', bodyKey: 'about.domDup1Body' },
      { titleKey: 'about.domDup2Title', bodyKey: 'about.domDup2Body' },
      { titleKey: 'about.domDup3Title', bodyKey: 'about.domDup3Body' }
    ]
  },
  {
    icon: Icons.shield,
    titleKey: 'about.domUndoTitle',
    items: [
      { titleKey: 'about.domUndo1Title', bodyKey: 'about.domUndo1Body' },
      { titleKey: 'about.domUndo2Title', bodyKey: 'about.domUndo2Body' },
      { titleKey: 'about.domUndo3Title', bodyKey: 'about.domUndo3Body' }
    ]
  },
  {
    icon: Icons.snapshot,
    titleKey: 'about.domSnapshotTitle',
    items: [
      { titleKey: 'about.domSnapshot1Title', bodyKey: 'about.domSnapshot1Body' },
      { titleKey: 'about.domSnapshot2Title', bodyKey: 'about.domSnapshot2Body' },
      { titleKey: 'about.domSnapshot3Title', bodyKey: 'about.domSnapshot3Body' },
      { titleKey: 'about.domSnapshot4Title', bodyKey: 'about.domSnapshot4Body' }
    ]
  },
  {
    icon: Icons.snowflake,
    titleKey: 'about.domDiscardTitle',
    items: [
      { titleKey: 'about.domDiscard1Title', bodyKey: 'about.domDiscard1Body' },
      { titleKey: 'about.domDiscard2Title', bodyKey: 'about.domDiscard2Body' },
      { titleKey: 'about.domDiscard3Title', bodyKey: 'about.domDiscard3Body' }
    ]
  },
  {
    icon: Icons.bookmarkAdd,
    titleKey: 'about.domDataTitle',
    items: [
      { titleKey: 'about.domData1Title', bodyKey: 'about.domData1Body' },
      { titleKey: 'about.domData2Title', bodyKey: 'about.domData2Body' },
      { titleKey: 'about.domData3Title', bodyKey: 'about.domData3Body' },
      { titleKey: 'about.domData4Title', bodyKey: 'about.domData4Body' }
    ]
  },
  {
    icon: Icons.infoAlert,
    titleKey: 'about.domDevTitle',
    items: [
      { titleKey: 'about.domDev1Title', bodyKey: 'about.domDev1Body' },
      { titleKey: 'about.domDev2Title', bodyKey: 'about.domDev2Body' },
      { titleKey: 'about.domDev3Title', bodyKey: 'about.domDev3Body' },
      { titleKey: 'about.domDev4Title', bodyKey: 'about.domDev4Body' }
    ]
  },
  {
    icon: Icons.settings,
    titleKey: 'about.domLookTitle',
    items: [
      { titleKey: 'about.domLook1Title', bodyKey: 'about.domLook1Body' },
      { titleKey: 'about.domLook2Title', bodyKey: 'about.domLook2Body' },
      { titleKey: 'about.domLook3Title', bodyKey: 'about.domLook3Body' },
      { titleKey: 'about.domLook4Title', bodyKey: 'about.domLook4Body' }
    ]
  }
];

/**
 * 快捷入口：能力本身的「怎么触发」。
 * 此前这些入口只写在一次性提示条（tips.discover）与 README 里，
 * 用户关掉提示后就没有地方能查到「右键菜单有哪些动作」「地址栏命令是什么」。
 */
const ENTRY_POINTS: { icon: LucideIcon; titleKey: string; bodyKey: string }[] = [
  { icon: Icons.menu, titleKey: 'about.entry1Title', bodyKey: 'about.entry1Body' },
  { icon: Icons.search, titleKey: 'about.entry2Title', bodyKey: 'about.entry2Body' },
  { icon: Icons.sparkles, titleKey: 'about.entry3Title', bodyKey: 'about.entry3Body' },
  { icon: Icons.shortcuts, titleKey: 'about.entry4Title', bodyKey: 'about.entry4Body' },
  { icon: Icons.pin, titleKey: 'about.entry5Title', bodyKey: 'about.entry5Body' }
];

/** 面板内快捷键（焦点在侧边栏时生效）。 */
const PANEL_SHORTCUTS: { key: string; keys: string[] }[] = [
  { key: 'about.shortcutSearch', keys: ['⌘/Ctrl', 'K'] },
  { key: 'about.shortcutPalette', keys: ['⌘/Ctrl', 'P'] },
  { key: 'about.shortcutLocate', keys: ['⌘/Ctrl', 'J'] },
  { key: 'about.shortcutRoam', keys: ['↑', '↓', 'Enter'] },
  { key: 'about.shortcutReorder', keys: ['Alt', '↑/↓'] },
  { key: 'about.shortcutDrag', keys: ['Space'] }
];

/**
 * 浏览器级全局快捷键（在任意页面生效）。
 * 与面板内快捷键分开列：这组可以在浏览器扩展快捷键页自行修改，
 * 写死默认值会让改了键的用户以为产品文档是错的。
 */
const GLOBAL_SHORTCUTS: { key: string; keys: string[] }[] = [
  { key: 'about.globalFocusSearch', keys: ['Ctrl', 'Shift', 'F'] },
  { key: 'about.globalOpenPanel', keys: ['Ctrl', 'Shift', 'O'] },
  { key: 'about.globalLocate', keys: ['Ctrl', 'Shift', 'L'] },
  { key: 'about.globalDiscard', keys: ['Ctrl', 'Shift', 'U'] }
];

/** 隐私承诺：产品宪法级底线，置于 Hero 之下最显眼处。 */
const PRIVACY_BADGES: string[] = [
  'about.badgeLocal',
  'about.badgeNoAccount',
  'about.badgeNoTelemetry',
  'about.badgeNoNetwork'
];

/** 隐私与数据事实（含权限口径，避免用户对「为什么需要这些权限」产生疑虑）。 */
const PRIVACY_FACTS: { titleKey: string; bodyKey: string }[] = [
  { titleKey: 'about.privacy1Title', bodyKey: 'about.privacy1Body' },
  { titleKey: 'about.privacy2Title', bodyKey: 'about.privacy2Body' },
  { titleKey: 'about.privacy3Title', bodyKey: 'about.privacy3Body' },
  { titleKey: 'about.privacy4Title', bodyKey: 'about.privacy4Body' },
  { titleKey: 'about.privacy5Title', bodyKey: 'about.privacy5Body' }
];

/** 技术与许可。 */
const TECH_FACTS: { titleKey: string; bodyKey: string }[] = [
  { titleKey: 'about.tech1Title', bodyKey: 'about.tech1Body' },
  { titleKey: 'about.tech2Title', bodyKey: 'about.tech2Body' },
  { titleKey: 'about.tech3Title', bodyKey: 'about.tech3Body' }
];

/** 区块标题样式统一（避免五处各写一遍）。 */
const SECTION_TITLE_CLASS = 'mb-3 text-sm font-semibold tracking-wide text-gray-600';
const CARD_CLASS = 'rounded-xl border border-gray-200 bg-surface p-4 transition-base';

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
          <h1 className="text-xl font-semibold text-gray-900">Tabs</h1>
          <p className="mt-1 text-sm text-gray-600">{t('about.tagline')}</p>
        </div>
        {version && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-3xs text-gray-500">
            {t('about.version', { version })}
          </span>
        )}
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {PRIVACY_BADGES.map((badgeKey) => (
            <li
              key={badgeKey}
              className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-3xs font-medium text-accent-700"
            >
              <Icon d={Icons.check} className="h-3 w-3" />
              {t(badgeKey)}
            </li>
          ))}
        </ul>
      </header>

      {/* 能力总览：域 → 能力点 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('about.capabilitiesTitle')}</h2>
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
        <h2 className={SECTION_TITLE_CLASS}>{t('about.entryPointsTitle')}</h2>
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

      {/* 键盘快捷键：面板内 + 浏览器级全局 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('about.shortcutsTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-surface px-4">
            <p className="pt-3 pb-1 text-2xs font-semibold tracking-wide text-gray-500">
              {t('about.panelShortcutsTitle')}
            </p>
            <ul className="divide-y divide-gray-100">
              {PANEL_SHORTCUTS.map((shortcut) => (
                <li key={shortcut.key} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-xs text-gray-700">{t(shortcut.key)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-2xs leading-none text-gray-600"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-gray-200 bg-surface px-4">
            <p className="pt-3 pb-1 text-2xs font-semibold tracking-wide text-gray-500">
              {t('about.globalShortcutsTitle')}
            </p>
            <ul className="divide-y divide-gray-100">
              {GLOBAL_SHORTCUTS.map((shortcut) => (
                <li key={shortcut.key} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-xs text-gray-700">{t(shortcut.key)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-2xs leading-none text-gray-600"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="pb-3 text-3xs leading-relaxed text-gray-500">
              {t('about.globalShortcutsHint')}
            </p>
          </div>
        </div>
      </section>

      {/* 隐私与数据 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('about.privacyTitle')}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PRIVACY_FACTS.map((fact) => (
            <li key={fact.titleKey} className={CARD_CLASS}>
              <p className="text-xs font-medium text-gray-700">{t(fact.titleKey)}</p>
              <p className="mt-1 text-3xs leading-relaxed text-gray-500">{t(fact.bodyKey)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 技术与许可 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('about.techTitle')}</h2>
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
        <p className="text-3xs leading-relaxed text-gray-500">{t('about.footerNote')}</p>
        <p className="mt-1 text-3xs text-gray-500">{t('about.footerLicense')}</p>
      </footer>
    </div>
  );
}
