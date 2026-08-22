import { SCENARIO_ART } from '../components/art/scenarios';
import { Section } from '../components/Section';
import { SCENARIOS } from '../content/scenarios';
import { useSiteI18n } from '../i18n';

/** 使用场景：把能力翻译成「你什么时候会用上」。 */
export function Scenarios() {
  const { t } = useSiteI18n();

  return (
    <Section
      id="scenarios"
      eyebrow={t('场景')}
      title={t('什么时候你会想起用它')}
      intro={t('四个最常见的时刻，以及它在那一刻替你做的事。')}
    >
      <ul className="scenario-grid">
        {SCENARIOS.map((item) => {
          const Art = SCENARIO_ART[item.art];
          return (
            <li key={item.titleKey} className="card scenario-card">
              <div className="scenario-art-wrap" aria-hidden="true">
                <Art />
              </div>
              <h3>{t(item.titleKey)}</h3>
              <p>{t(item.descKey)}</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
