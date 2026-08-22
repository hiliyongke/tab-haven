import { Download, Lock, ShieldCheck, WifiOff } from 'lucide-react';
import { BRAND } from '../../site.config';
import { DevtoolsZero } from '../components/art/DevtoolsZero';
import { MockupPanel } from '../components/MockupPanel';
import { useSiteI18n } from '../i18n';

export interface HeroProps {
  version: string;
  downloadHref: string;
}

export function Hero({ version, downloadHref }: HeroProps) {
  const { t } = useSiteI18n();

  return (
    <section className="hero" id="top">
      <div className="container hero-inner">
        <div className="hero-copy">
          <p className="hero-meta">
            {`v${version}`}
            <span aria-hidden="true">·</span>
            {t('Chrome / Edge / Brave ≥ 114')}
            <span aria-hidden="true">·</span>
            {t('无需账号')}
          </p>

          <h1 className="hero-title">{BRAND}</h1>
          <p className="hero-tagline">{t('把散乱的标签整理成一个本地侧边栏')}</p>
          <p className="hero-desc">
            {t(
              '按站点自动聚合、收进文件夹、关错了也能一层层撤回来。数据只留在本机，扩展不发起任何网络请求。'
            )}
          </p>

          <div className="hero-actions">
            <a className="btn btn-primary" href={downloadHref} download>
              <Download size={18} aria-hidden="true" />
              {t('下载扩展')}
              <span className="btn-note">zip</span>
            </a>
            <a className="btn btn-ghost" href="#demo">
              {t('看界面演示')}
            </a>
          </div>

          <ul className="trust-list">
            <li>
              <WifiOff size={16} aria-hidden="true" />
              {t('零出站网络请求')}
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" />
              {t('无需注册账号')}
            </li>
            <li>
              <Lock size={16} aria-hidden="true" />
              {t('数据只在本机')}
            </li>
          </ul>
        </div>

        {/* 大场景图：浏览器 + 侧边栏，角落压一张 DevTools 面板（0 requests） */}
        <div className="hero-visual">
          <div className="hero-scene">
            <MockupPanel variant="main" />
            <div className="hero-devtools">
              <DevtoolsZero />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
