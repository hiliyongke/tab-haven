import { Section } from '../components/Section';
import { ShortcutTable } from '../components/ShortcutTable';
import { useSiteI18n } from '../i18n';

interface StepCode {
  /**
   * 浏览器名。**刻意不进词典**：专有名词在两种语言下写法一致，进了会被 i18n-kit 的
   * 「伪翻译」检查拦下（译文与原文相同）。
   */
  browser: string;
  code: string;
}

/**
 * 三步上手：商店尚未上架，因此只讲「下载 → 解压 → 加载已解压」。
 *
 * 第 2 步的地址**必须按浏览器分列**：Chrome 与 Edge 的包内容完全一致（实测 manifest
 * 与产物字节级相同），真正不同的只有扩展管理页地址 —— `chrome://` 在 Edge 里不会跳转，
 * 这是 Edge 用户唯一会卡住的地方。
 */
const STEPS: readonly { titleKey: string; bodyKey: string; codes?: readonly StepCode[] }[] = [
  {
    titleKey: '下载压缩包并解压',
    bodyKey: '把 zip 解压到本地任意文件夹，解压后的文件夹就是扩展本体，之后不要移动它。'
  },
  {
    titleKey: '打开扩展管理页，开启开发者模式',
    bodyKey: '在地址栏打开下面对应浏览器的扩展管理页，打开右上角的「开发者模式」开关。',
    codes: [
      { browser: 'Chrome / Brave', code: 'chrome://extensions' },
      { browser: 'Edge', code: 'edge://extensions' }
    ]
  },
  {
    titleKey: '加载已解压的扩展程序',
    bodyKey: '点击「加载已解压的扩展程序」，选中第 1 步解压出来的文件夹即可，无需重启浏览器。'
  }
];

export interface QuickStartProps {
  downloadHref: string;
}

export function QuickStart({ downloadHref }: QuickStartProps) {
  const { t } = useSiteI18n();

  return (
    <Section
      id="start"
      eyebrow={t('上手')}
      title={t('三步装好，一分钟内开始用')}
      intro={t(
        '尚未在应用商店上架，当前以压缩包形式提供；加载后由浏览器自动保持更新之外的手动升级。'
      )}
    >
      <ol className="step-list">
        {STEPS.map((step, index) => (
          <li key={step.titleKey} className="card step-card">
            <span className="step-index" aria-hidden="true">
              {index + 1}
            </span>
            <h3>{t(step.titleKey)}</h3>
            <p>{t(step.bodyKey)}</p>
            {step.codes ? (
              <ul className="step-codes">
                {step.codes.map((item) => (
                  <li key={item.code} className="step-code-row">
                    <span className="step-code-browser">{item.browser}</span>
                    <code>{item.code}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="start-grid">
        <div className="card">
          <h3>{t('装好后怎么打开')}</h3>
          <ul className="check-list">
            <li>{t('点击工具栏上的扩展图标，打开侧边栏')}</li>
            <li>{t('按 Ctrl / ⌘ + Shift + O 直接唤起面板')}</li>
            <li>{t('在地址栏输入 t 加空格，直达标签与收藏条目')}</li>
            <li>{t('在网页、链接或标签上右键，使用快捷操作')}</li>
          </ul>
          <p className="muted start-hint">
            {t('还没下载？')} <a href={downloadHref}>{t('先拿压缩包')}</a>
          </p>
        </div>
        <div className="card">
          <h3>{t('快捷键速查')}</h3>
          <ShortcutTable />
        </div>
      </div>
    </Section>
  );
}
