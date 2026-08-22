import { useTranslation } from 'react-i18next';

export default function App() {
  const { t } = useTranslation();
  return (
    <main className="app">
      <h1>{t('app.name')}</h1>
      <p>{t('app.scaffold')}</p>
    </main>
  );
}
