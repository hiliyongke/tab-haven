import { BRAND } from '../../site.config';
import { useSiteI18n } from '../i18n';
import { BrandMark } from './BrandMark';

/** 页脚链接组：全部站内锚点 —— 项目暂不开源，不出现仓库地址与联系方式。 */
const FOOTER_GROUPS: readonly {
  titleKey: string;
  links: readonly { href: string; labelKey: string }[];
}[] = [
  {
    titleKey: '产品',
    links: [
      { href: '#top', labelKey: '概览' },
      { href: '#features', labelKey: '功能' },
      { href: '#demo', labelKey: '界面演示' },
      { href: '#start', labelKey: '安装上手' },
      { href: '#scenarios', labelKey: '使用场景' }
    ]
  },
  {
    titleKey: '资源',
    links: [
      { href: '#docs', labelKey: '隐私承诺' },
      { href: '#docs', labelKey: '权限说明' },
      { href: '#docs', labelKey: '快捷键' },
      { href: '#compare', labelKey: '能力对比' },
      { href: '#faq', labelKey: '常见问题' }
    ]
  }
];

export interface SiteFooterProps {
  version: string;
  /** 版权年份：构建期注入，避免写死后每年过期 */
  year: string;
}

export function SiteFooter({ version, year }: SiteFooterProps) {
  const { t } = useSiteI18n();

  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <BrandMark size={28} idSuffix="-footer" />
          <p className="footer-wordmark">{BRAND}</p>
          <p className="muted footer-note">{t('本地优先的浏览器标签工作台')}</p>
        </div>

        {FOOTER_GROUPS.map((group) => (
          <nav key={group.titleKey} className="footer-group" aria-label={t(group.titleKey)}>
            <h3 className="footer-group-title">{t(group.titleKey)}</h3>
            <ul>
              {group.links.map((link) => (
                <li key={`${group.titleKey}-${link.labelKey}`}>
                  <a href={link.href}>{t(link.labelKey)}</a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="container footer-bottom">
        {/* 刻意不写许可：项目暂不开源，页脚只声明版权与版本。
            等真正开源时再补许可行 —— 现在写「MIT」会让读者误以为能拿到源码。 */}
        <p>{`© ${year} ${BRAND} · v${version}`}</p>
        <p className="muted">{t('本站不使用 Cookie，也没有任何统计脚本。')}</p>
      </div>
    </footer>
  );
}
