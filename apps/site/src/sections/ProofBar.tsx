import { PROOF_STATS } from '../content/proof';
import { useSiteI18n } from '../i18n';

/**
 * 信任数字带。
 *
 * 业界常见的是 Logo 墙与用户评价，但产品未上架、没有真实用户 —— 编出来的背书
 * 一眼假。这里改用四个**可核验**的数字承担同样的说服作用。
 */
export function ProofBar() {
  const { t } = useSiteI18n();

  return (
    <div className="proof-bar">
      <ul className="proof-list">
        {PROOF_STATS.map((stat) => (
          <li key={stat.value} className="proof-item">
            <span className="proof-value">{stat.value}</span>
            <span className="proof-label">{t(stat.labelKey)}</span>
            <span className="proof-note">{t(stat.noteKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
