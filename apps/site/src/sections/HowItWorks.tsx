import { Section } from '../components/Section';
import { WORK_STEPS } from '../content/howItWorks';
import { useSiteI18n } from '../i18n';

/** 工作原理：与「快速开始」互补 —— 那边讲怎么装，这里讲它怎么工作。 */
export function HowItWorks() {
  const { t } = useSiteI18n();

  return (
    <Section
      id="how"
      eyebrow={t('原理')}
      title={t('它每天替你做的三件事')}
      intro={t('没有后台同步，也没有云端计算 —— 三步全部发生在这台机器上。')}
    >
      <ol className="work-steps">
        {WORK_STEPS.map((step, index) => (
          <li key={step.titleKey} className="work-step">
            <span className="work-index" aria-hidden="true">
              {index + 1}
            </span>
            <h3>{t(step.titleKey)}</h3>
            <p>{t(step.descKey)}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
