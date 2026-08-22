import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { deriveTemporarySections } from '@/core/site/Sections';
import type { TabRecord } from '@/core/tab-types';
import { useTabStore } from '@/stores/tabStore';

function TabRow({ tab }: { tab: TabRecord }) {
  const activateTab = useTabStore((state) => state.activateTab);
  return (
    <button
      type="button"
      className={
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-gray-100' +
        (tab.active ? ' bg-gray-100' : '')
      }
      onClick={() => void activateTab(tab.id)}
      title={tab.title || tab.url || ''}
    >
      <span className="truncate">{tab.title || '无标题标签页'}</span>
    </button>
  );
}

function Section({ title, tabs }: { title: string; tabs: TabRecord[] }) {
  return (
    <section className="mb-2">
      <h2 className="px-2 py-1 text-xs font-medium text-gray-500">{title}</h2>
      <div>
        {tabs.map((tab) => (
          <TabRow key={tab.id} tab={tab} />
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const { t } = useTranslation();
  const tabs = useTabStore((state) => state.tabs);
  const startTabSync = useTabStore((state) => state.startTabSync);

  useEffect(() => startTabSync(), [startTabSync]);

  const sections = deriveTemporarySections(tabs);

  return (
    <main className="app flex h-full flex-col p-2">
      <h1 className="mb-2 px-2 text-sm font-semibold">{t('app.name')}</h1>
      {tabs.length === 0 ? (
        <p className="px-2 text-sm text-gray-500">{t('app.scaffold')}</p>
      ) : (
        <div>
          {sections.map((section) => (
            <Section key={section.key} title={section.title} tabs={section.tabs} />
          ))}
        </div>
      )}
    </main>
  );
}
