import { BRAND } from '../../site.config';
import { Section } from '../components/Section';
import { COMPARISON } from '../content/comparison';
import { useSiteI18n } from '../i18n';

/**
 * 三方对比表。
 *
 * 不点名具体产品、不贬低：第三方栏位写的是这一类工具的普遍做法，拿不准就写
 * 「视产品而定」。品牌名 Tabs 是标识符，不进词典。
 */
export function Comparison() {
  const { t } = useSiteI18n();

  return (
    <Section
      id="compare"
      eyebrow={t('对比')}
      title={t('和另外两条路有什么不同')}
      intro={t('浏览器自带的能力、云同步型标签工具，以及本地优先这条路的取舍。')}
    >
      <div className="table-wrap">
        <table className="data-table compare-table">
          <caption className="visually-hidden">{t('能力对比')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('能力')}</th>
              <th scope="col" className="is-brand">
                {BRAND}
              </th>
              <th scope="col">{t('浏览器原生')}</th>
              <th scope="col">{t('云同步型工具')}</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.featureKey}>
                <th scope="row">{t(row.featureKey)}</th>
                <td className="is-brand">{t(row.tabsKey)}</td>
                <td>{t(row.nativeKey)}</td>
                <td>{t(row.cloudKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
