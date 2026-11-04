import { useTranslation } from '@/i18n';
import { getExtensionVersion } from '@/platform/navigation';
import { Chip } from '@/ui/common/Chip';
import { Icon, Icons } from '@/ui/common/Icon';
import { IconTile } from '@/ui/common/IconTile';
import { Kbd } from '@/ui/common/Kbd';
import {
  CAPABILITY_GROUPS,
  ENTRY_POINTS,
  PANEL_SHORTCUTS,
  GLOBAL_SHORTCUTS,
  PRIVACY_BADGES,
  PRIVACY_FACTS,
  PERMISSION_FACTS,
  TRUST_EXTRA_FACTS,
  TECH_FACTS,
  SECTION_TITLE_CLASS,
  CARD_CLASS
} from './aboutData';

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

/** 事实卡：标题 + 一段说明（隐私 / 信任补充 / 技术三处共用同一形态）。 */
function FactItem({ title, body }: { title: string; body: string }) {
  return (
    <li className={CARD_CLASS}>
      <p className="text-xs font-medium text-gray-700">{title}</p>
      <p className="mt-1 text-3xs leading-relaxed text-gray-500">{body}</p>
    </li>
  );
}

/**
 * 快捷键卡片：分组标题 + 键位行（侧边栏内 / 浏览器级全局共用同一段 JSX，仅标题与脚注不同）。
 */
function ShortcutList({
  title,
  items,
  footnote
}: {
  title: string;
  items: { labelKey: string; keys: string[] }[];
  footnote?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-gray-200 bg-surface px-4 py-3">
      {/* 11px/500 而非 10px/600：层级应是 14/600 → 12/500 → 11/500 单调递减，
          最小一级字重回弹到 600 会比上一级还重，且 10px 低于 11px 下限。 */}
      <p className="group-label pb-1">{title}</p>
      <ul className="divide-y divide-gray-100">
        {items.map((shortcut) => (
          <li key={shortcut.labelKey} className="flex items-center justify-between gap-4 py-2">
            <span className="text-xs text-gray-700">{t(shortcut.labelKey)}</span>
            <span className="flex shrink-0 items-center gap-1">
              {shortcut.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {footnote && <p className="mt-2 text-3xs leading-relaxed text-gray-500">{footnote}</p>}
    </div>
  );
}

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
          <p className="mt-1 text-sm text-gray-600">
            {t('本地优先、无自有账号、无自有服务器的标签工作台')}
          </p>
        </div>
        {version && (
          /* 版本胶囊走 Chip 中性档（gray-600，满足 AA）：gray-500 在 gray-100 底上仅 3.92:1。 */
          <Chip cjk size="md">
            {t('版本 {{version}}', { version })}
          </Chip>
        )}
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {PRIVACY_BADGES.map((badge) => (
            <li key={badge.labelKey}>
              <Chip tone="brand" cjk size="md" className="inline-flex items-center gap-1">
                <Icon d={Icons.check} className="h-3 w-3" />
                {t(badge.labelKey)}
              </Chip>
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
                <IconTile size="sm">
                  <Icon d={group.icon} className="h-3.5 w-3.5" />
                </IconTile>
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
                <IconTile size="sm" tone="neutral">
                  <Icon d={entry.icon} className="h-3.5 w-3.5" />
                </IconTile>
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
          <ShortcutList title={t('侧边栏内')} items={PANEL_SHORTCUTS} />
          <ShortcutList
            title={t('浏览器级（全局）')}
            items={GLOBAL_SHORTCUTS}
            footnote={t('这组快捷键可在浏览器的扩展快捷键设置页自行修改。')}
          />
        </div>
      </section>

      {/* 隐私与数据 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('隐私与数据')}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PRIVACY_FACTS.map((fact) => (
            <FactItem key={fact.titleKey} title={t(fact.titleKey)} body={t(fact.bodyKey)} />
          ))}
        </ul>
      </section>

      {/* 信任面板：权限 → 用途映射 + 数据位置 + 自行验证教程 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('权限与用途')}</h2>
        {/* max-w-[65ch]：容器 896px 下 11px 字号单行约 77 个汉字，远超舒适阅读宽度 */}
        <p className="mb-3 max-w-[65ch] text-3xs leading-relaxed text-gray-500">
          {t('下表列出本扩展声明的权限及其用途。')}
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
            <FactItem key={fact.titleKey} title={t(fact.titleKey)} body={t(fact.bodyKey)} />
          ))}
        </ul>
      </section>

      {/* 技术与验证 */}
      <section className="mt-8">
        <h2 className={SECTION_TITLE_CLASS}>{t('技术与验证')}</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {TECH_FACTS.map((fact) => (
            <FactItem key={fact.titleKey} title={t(fact.titleKey)} body={t(fact.bodyKey)} />
          ))}
        </ul>
      </section>

      {/* 页脚 */}
      <footer className="mt-10 border-t border-gray-200 pt-4">
        <p className="max-w-[65ch] text-3xs leading-relaxed text-gray-500">
          {t('无自有服务器 · 无自有账号 · 无遥测 · 零出站网络请求；数据默认只存在于你的浏览器里。')}
        </p>
      </footer>
    </div>
  );
}
