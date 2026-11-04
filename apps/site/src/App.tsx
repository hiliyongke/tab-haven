import { DOWNLOAD_DIR } from '../site.config';
import { SiteFooter } from './components/SiteFooter';
import { SiteNav } from './components/SiteNav';
import { Comparison } from './sections/Comparison';
import { CtaBand } from './sections/CtaBand';
import { Demo } from './sections/Demo';
import { Docs } from './sections/Docs';
import { Faq } from './sections/Faq';
import { Features } from './sections/Features';
import { Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { PrivacyFlow } from './sections/PrivacyFlow';
import { ProofBar } from './sections/ProofBar';
import { QuickStart } from './sections/QuickStart';
import { Scenarios } from './sections/Scenarios';
import { useSiteI18n } from './i18n';

interface AppProps {
  version: string;
  year: string;
  lng: string;
  downloadHref?: string | null;
}

export function App({ version, year, lng, downloadHref }: AppProps) {
  const { t } = useSiteI18n();
  const resolvedDownloadHref =
    downloadHref === undefined ? `${DOWNLOAD_DIR}tabs-${version}.zip` : downloadHref;

  return (
    <>
      <a className="skip-link" href="#main">
        {t('跳到主要内容')}
      </a>

      <SiteNav lng={lng} downloadHref={resolvedDownloadHref} />

      {/* tabIndex=-1：锚点跳转后把焦点真正落到主内容上，否则键盘用户按 Tab 会绕回导航 */}
      <main id="main" tabIndex={-1}>
        <Hero version={version} downloadHref={resolvedDownloadHref} />
        <ProofBar />
        <Features />
        <Demo />
        <Scenarios />
        <HowItWorks />
        <PrivacyFlow />
        <Comparison />
        <QuickStart downloadHref={resolvedDownloadHref} />
        <Docs />
        <Faq />
        <CtaBand version={version} downloadHref={resolvedDownloadHref} />
        {resolvedDownloadHref === null ? (
          <p className="container muted preview-note">{t('仅本地预览，下载包未随此构建发布')}</p>
        ) : null}
      </main>

      <SiteFooter version={version} year={year} />
    </>
  );
}
