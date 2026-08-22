import { Section } from '../components/Section';
import { FAQ } from '../content/faq';
import { useSiteI18n } from '../i18n';

/**
 * 常见问题：原生 `<details>`，零脚本可用 —— 没有 JS 时全部展开即可读。
 */
export function Faq() {
  const { t } = useSiteI18n();

  return (
    <Section
      id="faq"
      eyebrow={t('常见问题')}
      title={t('你大概会问的几件事')}
      intro={t('没找到答案的问题，可以在扩展的关于页里查看完整的权限与数据说明。')}
    >
      <div className="faq-list">
        {FAQ.map((item) => (
          <details key={item.qKey} className="card faq-item">
            <summary>
              <h3>{t(item.qKey)}</h3>
            </summary>
            <p>{t(item.aKey)}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
