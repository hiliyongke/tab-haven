import { useTranslation } from 'react-i18next';

/** 快速切换器（降级形态入口，FR-D10.1）：搜索增强的天然载体。脚手架占位。 */
export default function App() {
  const { t } = useTranslation();
  return (
    <main className="quick-switcher">
      <h1>{t('app.name')}</h1>
      <p>{t('app.scaffold')}</p>
    </main>
  );
}
