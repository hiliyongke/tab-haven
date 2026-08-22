import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import {
  buildExport,
  buildUrlList,
  mergeFolders,
  mergePins,
  parseImport,
  serializeExport
} from '@/core/data/ExportService';
import type { Settings } from '@/core/schema/models';
import { hasLegacyData, migrateFromTabstead } from '@/platform/migrate/migration';
import { useDataStore } from '@/stores/dataStore';

/**
 * 全页形态（FR-D9.1/D9.2/D10.2）：设置、导入导出、Tabstead 迁移。
 */

function downloadFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const folders = useDataStore((state) => state.folders);
  const pins = useDataStore((state) => state.pins);
  const collapsedSites = useDataStore((state) => state.collapsedSites);
  const settings = useDataStore((state) => state.settings);
  const initialize = useDataStore((state) => state.initialize);
  const updateSettings = useDataStore((state) => state.updateSettings);

  const [importMode, setImportMode] = useState<'merge' | 'overwrite'>('merge');
  const [message, setMessage] = useState<string>('');
  const [legacyAvailable, setLegacyAvailable] = useState(false);

  useEffect(() => {
    void initialize();
    void hasLegacyData().then(setLegacyAvailable);
  }, [initialize]);

  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 4_000);
  };

  const handleExport = () => {
    const exportFile = buildExport({ folders, pins, collapsedSites, settings });
    downloadFile('tabhaven-export.json', serializeExport(exportFile));
    const urlList = buildUrlList({ folders, pins, collapsedSites, settings });
    downloadFile('tabhaven-urls.txt', urlList);
    notify(t('data.exported'));
  };

  const handleImportFile = async (file: File) => {
    const result = parseImport(await file.text());
    if (!result.ok) {
      notify(result.error);
      return;
    }
    const incoming = result.data;
    if (importMode === 'overwrite') {
      await Promise.all([
        browser.storage.local.set({
          'tabhaven.fixed-folders.v1': incoming.fixedFolders,
          'tabhaven.persistent-pins.v1': incoming.persistentPins,
          'tabhaven.site-collapse.v1': incoming.siteCollapse,
          'tabhaven.settings.v1': incoming.settings
        })
      ]);
    } else {
      await Promise.all([
        browser.storage.local.set({
          'tabhaven.fixed-folders.v1': mergeFolders(folders, incoming.fixedFolders),
          'tabhaven.persistent-pins.v1': mergePins(pins, incoming.persistentPins)
        })
      ]);
    }
    await initialize();
    notify(t('data.imported'));
  };

  const handleMigrate = async () => {
    const report = await migrateFromTabstead();
    notify(
      `${t('data.migrated')}（文件夹 ${report.migratedFolders} · 固定图标 ${report.migratedPins} · 主题 ${report.migratedTheme ? '✓' : '—'}）`
    );
    setLegacyAvailable(false);
  };

  const themeOptions: Array<{ value: Settings['themePreference']; label: string }> = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') }
  ];

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold">{t('settings.title')}</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-gray-600">{t('settings.theme')}</h2>
        <div className="flex gap-2">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                'rounded border px-3 py-1 text-sm' +
                (settings.themePreference === option.value
                  ? ' border-blue-500 bg-blue-50 text-blue-600'
                  : ' border-gray-200 hover:bg-gray-50')
              }
              onClick={() => void updateSettings({ themePreference: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-gray-600">{t('settings.language')}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className={
              'rounded border px-3 py-1 text-sm' +
              (i18n.language === 'zh-CN'
                ? ' border-blue-500 bg-blue-50 text-blue-600'
                : ' border-gray-200 hover:bg-gray-50')
            }
            onClick={() => {
              void i18n.changeLanguage('zh-CN');
              void updateSettings({ language: 'zh-CN' });
            }}
          >
            简体中文
          </button>
          <button
            type="button"
            className={
              'rounded border px-3 py-1 text-sm' +
              (i18n.language === 'en'
                ? ' border-blue-500 bg-blue-50 text-blue-600'
                : ' border-gray-200 hover:bg-gray-50')
            }
            onClick={() => {
              void i18n.changeLanguage('en');
              void updateSettings({ language: 'en' });
            }}
          >
            English
          </button>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-gray-600">{t('settings.threshold')}</h2>
        <select
          className="rounded border border-gray-200 px-2 py-1 text-sm"
          value={settings.aggregationThreshold}
          onChange={(event) =>
            void updateSettings({ aggregationThreshold: Number(event.target.value) })
          }
        >
          {[2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-gray-600">{t('data.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            onClick={handleExport}
          >
            {t('data.export')}
          </button>
          <label className="cursor-pointer rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            {t('data.import')}
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportFile(file);
                event.target.value = '';
              }}
            />
          </label>
          <select
            className="rounded border border-gray-200 px-2 py-1.5 text-sm"
            value={importMode}
            onChange={(event) => setImportMode(event.target.value as 'merge' | 'overwrite')}
          >
            <option value="merge">{t('data.mergeMode')}</option>
            <option value="overwrite">{t('data.overwriteMode')}</option>
          </select>
        </div>
      </section>

      {legacyAvailable && (
        <section className="mb-8 rounded border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-1 text-sm font-medium text-amber-800">{t('data.legacyTitle')}</h2>
          <p className="mb-2 text-sm text-amber-700">{t('data.legacyHint')}</p>
          <button
            type="button"
            className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
            onClick={() => void handleMigrate()}
          >
            {t('data.migrate')}
          </button>
        </section>
      )}

      {message && (
        <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700" role="status">
          {message}
        </p>
      )}
    </main>
  );
}
