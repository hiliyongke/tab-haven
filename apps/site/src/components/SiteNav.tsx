import { Download, Menu } from 'lucide-react';
import { BRAND, LANGUAGES, languageOf } from '../../site.config';
import { useSiteI18n } from '../i18n';
import { BrandMark } from './BrandMark';

/** 锚点导航项（labelKey 会被 i18n-kit 的常量表通道扫进词典）。 */
const NAV_ITEMS: readonly { id: string; labelKey: string }[] = [
  { id: 'features', labelKey: '功能' },
  { id: 'demo', labelKey: '演示' },
  { id: 'start', labelKey: '上手' },
  { id: 'docs', labelKey: '文档' },
  { id: 'faq', labelKey: '常见问题' }
];

export interface SiteNavProps {
  lng: string;
  downloadHref: string;
}

export function SiteNav({ lng, downloadHref }: SiteNavProps) {
  const { t } = useSiteI18n();
  const current = languageOf(lng);

  return (
    <header className="site-nav">
      <div className="container nav-inner">
        <a className="brand" href={current.path}>
          <BrandMark size={28} idSuffix="-nav" />
          <span className="brand-name">{BRAND}</span>
        </a>

        <button
          className="nav-toggle"
          type="button"
          aria-expanded="false"
          aria-controls="nav-menu"
          aria-label={t('展开导航菜单')}
        >
          <Menu size={20} aria-hidden="true" />
        </button>

        <div className="nav-menu" id="nav-menu">
          <nav aria-label={t('页面导航')}>
            <ul className="nav-links">
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`}>{t(item.labelKey)}</a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="nav-actions">
            <div className="lang-switch">
              {LANGUAGES.map((lang) => (
                <a
                  key={lang.code}
                  href={lang.path}
                  lang={lang.htmlLang}
                  aria-current={lang.code === current.code ? 'page' : undefined}
                >
                  {lang.label}
                </a>
              ))}
            </div>
            <a className="btn btn-primary btn-sm" href={downloadHref} download>
              <Download size={16} aria-hidden="true" />
              {t('下载')}
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
