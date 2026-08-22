import { PERMISSIONS } from '../content/permissions';
import { useSiteI18n } from '../i18n';

/**
 * 权限逐条说明表。
 *
 * 与 `wxt.config.ts` 的权限清单一一对应；「可选」标记的是默认不授予、按需询问的
 * 主机权限。
 */
export function PermissionTable() {
  const { t } = useSiteI18n();
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">{t('权限与用途')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('权限')}</th>
            <th scope="col">{t('用途')}</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSIONS.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                <code>{row.name}</code>
                {row.optional ? <span className="tag">{t('可选')}</span> : null}
              </th>
              <td>{t(row.purposeKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
