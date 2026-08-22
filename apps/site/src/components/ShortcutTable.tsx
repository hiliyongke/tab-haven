import { SHORTCUTS } from '../content/shortcuts';
import { useSiteI18n } from '../i18n';

/** 快捷键表：按键字面量各语言一致，只有说明进词典。 */
export function ShortcutTable() {
  const { t } = useSiteI18n();
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">{t('快捷键与命令')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('按键')}</th>
            <th scope="col">{t('作用')}</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((row) => (
            <tr key={row.keys ?? row.keysKey ?? row.descKey}>
              <th scope="row">
                <kbd>{row.keysKey ? t(row.keysKey) : row.keys}</kbd>
              </th>
              <td>{t(row.descKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
