import { Download } from 'lucide-react';
import { BRAND } from '../../site.config';
import { useSiteI18n } from '../i18n';

export interface CtaBandProps {
  version: string;
  downloadHref: string;
}

/** 结尾 CTA 带：读完所有说明之后，把行动再递一次。 */
export function CtaBand({ version, downloadHref }: CtaBandProps) {
  const { t } = useSiteI18n();

  return (
    <section className="cta-band" aria-labelledby="cta-title">
      <div className="container cta-inner">
        <h2 id="cta-title">{t('把这一屏标签，交给你自己管')}</h2>
        <p>{t('下载压缩包，解压后加载即可使用 —— 不需要账号，也不会有任何数据离开这台机器。')}</p>
        <a className="btn btn-primary btn-lg" href={downloadHref} download>
          <Download size={18} aria-hidden="true" />
          {t('下载扩展')}
          <span className="btn-note">zip</span>
        </a>
        <p className="cta-note">{`${BRAND} v${version} · ${t('Chrome / Edge / Brave ≥ 114')}`}</p>
      </div>
    </section>
  );
}
