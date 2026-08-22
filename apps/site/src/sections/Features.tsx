import {
  Camera,
  ChartColumn,
  FolderOpen,
  LayoutGrid,
  MoveVertical,
  Search,
  ShieldCheck,
  Snowflake,
  Undo2,
  Zap,
  type LucideIcon
} from 'lucide-react';
import type { ReactElement } from 'react';
import { CleanupArt } from '../components/art/CleanupArt';
import { DataFlowArt } from '../components/art/DataFlowArt';
import { GroupBeforeAfter } from '../components/art/GroupBeforeAfter';
import { UndoStackArt } from '../components/art/UndoStackArt';
import { Section } from '../components/Section';
import { FEATURES, type FeatureIcon } from '../content/features';
import { PILLARS, type PillarArt } from '../content/pillars';
import { useSiteI18n } from '../i18n';

const PILLAR_ART: Record<PillarArt, () => ReactElement> = {
  organize: GroupBeforeAfter,
  recover: UndoStackArt,
  tidy: CleanupArt,
  trust: DataFlowArt
};

const ICONS: Record<FeatureIcon, LucideIcon> = {
  grid: LayoutGrid,
  folder: FolderOpen,
  search: Search,
  drag: MoveVertical,
  undo: Undo2,
  camera: Camera,
  snowflake: Snowflake,
  insight: ChartColumn,
  zap: Zap,
  shield: ShieldCheck
};

export function Features() {
  const { t } = useSiteI18n();

  return (
    <Section
      id="features"
      eyebrow={t('功能')}
      title={t('把一屏标签管起来的十件事')}
      intro={t('全部能力都在本机运行：不联网、不上传、不需要账号，卸载即清除。')}
    >
      {/* 四大主题：图文交替 —— 先看懂它解决什么，再看清单里有多少能力 */}
      <div className="pillars">
        {PILLARS.map((pillar, index) => {
          const Art = PILLAR_ART[pillar.art];
          return (
            <div key={pillar.titleKey} className={`pillar${index % 2 === 1 ? ' is-reverse' : ''}`}>
              <div className="art-plate pillar-art" aria-hidden="true">
                <Art />
              </div>
              <div className="pillar-copy">
                <span className="eyebrow">{t(pillar.eyebrowKey)}</span>
                <h3>{t(pillar.titleKey)}</h3>
                <p>{t(pillar.bodyKey)}</p>
                <ul className="check-list">
                  {pillar.points.map((point) => (
                    <li key={point.pointKey}>{t(point.pointKey)}</li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      {/* 能力清单：信息密度不丢，图文交替讲不完的都在这里 */}
      <h3 className="feature-subhead">{t('能力清单')}</h3>
      <ul className="feature-grid">
        {FEATURES.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.titleKey} className="card feature-card">
              <span className="card-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h4>{t(item.titleKey)}</h4>
              <p>{t(item.descKey)}</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
