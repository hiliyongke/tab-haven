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

export interface AppProps {
  version: string;
  year: string;
  lng: string;
}

export function App({ version, year, lng }: AppProps) {
  const { t } = useSiteI18n();
  const downloadHref = `${DOWNLOAD_DIR}tabs-${version}.zip`;

  return (
    <>
      <a className="skip-link" href="#main">
        {t('跳到主要内容')}
      </a>

      <SiteNav lng={lng} downloadHref={downloadHref} />

      {/* tabIndex=-1：锚点跳转后把焦点真正落到主内容上，否则键盘用户按 Tab 会绕回导航 */}
      <main id="main" tabIndex={-1}>
        <Hero version={version} downloadHref={downloadHref} />
        <ProofBar />
        <Features />
        <Demo />
        <Scenarios />
        <HowItWorks />
        <PrivacyFlow />
        <Comparison />
        <QuickStart downloadHref={downloadHref} />
        <Docs />
        <Faq />
        <CtaBand version={version} downloadHref={downloadHref} />
      </main>

      <SiteFooter version={version} year={year} />
    </>
  );
}
