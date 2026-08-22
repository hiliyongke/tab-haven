import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { useDataStore } from '@/stores/dataStore';
import type { Settings } from '@/core/schema/models';

type SidePanelSide = 'left' | 'right' | 'unknown';
type SidePanelLayoutApi = { getLayout?: () => Promise<{ side: 'left' | 'right' }> };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200 bg-surface">
        {children}
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm text-gray-800">{label}</div>
        {hint && <div className="mt-0.5 text-2xs text-gray-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={
        'relative h-5 w-9 rounded-full transition-base ' +
        (checked ? 'bg-accent-500' : ' bg-gray-300')
      }
    >
      <span
        className={
          'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-base ' +
          (checked ? ' left-[18px]' : ' left-0.5')
        }
      />
    </button>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-800 outline-none focus:border-accent-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useDataStore((state) => state.settings);
  const ready = useDataStore((state) => state.ready);
  const updateSettings = useDataStore((state) => state.updateSettings);
  const exportData = useDataStore((state) => state.exportData);
  const importData = useDataStore((state) => state.importData);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [sidePanelSide, setSidePanelSide] = useState<SidePanelSide>('unknown');

  useEffect(() => {
    let cancelled = false;
    const sidePanel = browser.sidePanel as SidePanelLayoutApi | undefined;
    if (!sidePanel?.getLayout) return;
    void sidePanel
      .getLayout()
      .then(({ side }) => {
        if (!cancelled) setSidePanelSide(side);
      })
      .catch(() => {
        if (!cancelled) setSidePanelSide('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    updateSettings({ [key]: value } as Partial<Settings>);

  const handleExport = () => {
    const payload = JSON.stringify(exportData(), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `tabhaven-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setTransferStatus(t('settings.exportSuccess'));
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const raw: unknown = JSON.parse(await file.text());
      if (!window.confirm(t('settings.importConfirm'))) return;
      await importData(raw);
      setTransferStatus(t('settings.importSuccess'));
    } catch {
      setTransferStatus(t('settings.importFailed'));
    }
  };

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-6 py-10 text-sm text-gray-500">{t('settings.loading')}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-6 text-xl font-semibold text-gray-900">{t('settings.title')}</h1>

      <Section title={t('settings.appearance')}>
        <Row label={t('settings.theme')}>
          <Select
            value={settings.themePreference}
            onChange={(v) => set('themePreference', v)}
            options={[
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') }
            ]}
          />
        </Row>
        <Row label={t('settings.density')}>
          <Select
            value={settings.density}
            onChange={(v) => set('density', v)}
            options={[
              { value: 'compact', label: t('settings.densityCompact') },
              { value: 'cozy', label: t('settings.densityCozy') }
            ]}
          />
        </Row>
        <Row label={t('settings.showPinnedStrip')} hint={t('settings.showPinnedStripHint')}>
          <Toggle
            checked={settings.showPinnedStrip}
            onChange={(v) => set('showPinnedStrip', v)}
            ariaLabel={t('settings.showPinnedStrip')}
          />
        </Row>
        <Row label={t('settings.sidePanelPosition')} hint={t('settings.sidePanelPositionHint')}>
          <span className="rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-600">
            {sidePanelSide === 'left'
              ? t('settings.sidePanelPositionLeft')
              : sidePanelSide === 'right'
                ? t('settings.sidePanelPositionRight')
                : t('settings.sidePanelPositionUnknown')}
          </span>
        </Row>
        <Row label={t('settings.showUrl')} hint={t('settings.showUrlHint')}>
          <Toggle
            checked={settings.showUrl}
            onChange={(v) => set('showUrl', v)}
            ariaLabel={t('settings.showUrl')}
          />
        </Row>
        <Row label={t('settings.showSplitBadges')} hint={t('settings.showSplitBadgesHint')}>
          <Toggle
            checked={settings.showSplitBadges}
            onChange={(v) => set('showSplitBadges', v)}
            ariaLabel={t('settings.showSplitBadges')}
          />
        </Row>
      </Section>

      <Section title={t('settings.behavior')}>
        <Row label={t('settings.language')}>
          <Select
            value={settings.language ?? 'zh-CN'}
            onChange={(v) => set('language', v)}
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en', label: 'English' }
            ]}
          />
        </Row>
        <Row label={t('settings.autoScrollActive')} hint={t('settings.autoScrollActiveHint')}>
          <Toggle
            checked={settings.autoScrollActive}
            onChange={(v) => set('autoScrollActive', v)}
            ariaLabel={t('settings.autoScrollActive')}
          />
        </Row>
        <Row label={t('settings.closeOnMiddleClick')} hint={t('settings.closeOnMiddleClickHint')}>
          <Toggle
            checked={settings.closeOnMiddleClick}
            onChange={(v) => set('closeOnMiddleClick', v)}
            ariaLabel={t('settings.closeOnMiddleClick')}
          />
        </Row>
        <Row label={t('settings.sortMode')}>
          <Select
            value={settings.sortMode}
            onChange={(v) => set('sortMode', v)}
            options={[
              { value: 'browser', label: t('settings.sortBrowser') },
              { value: 'recency', label: t('settings.sortRecency') }
            ]}
          />
        </Row>
        <Row label={t('settings.tabOrderSync')} hint={t('settings.tabOrderSyncHint')}>
          <Toggle
            checked={settings.tabOrderSync}
            onChange={(v) => set('tabOrderSync', v)}
            ariaLabel={t('settings.tabOrderSync')}
          />
        </Row>
        <Row label={t('settings.threshold')} hint={t('settings.thresholdHint')}>
          <Select
            value={String(settings.aggregationThreshold)}
            onChange={(v) => set('aggregationThreshold', Number(v))}
            options={[
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' },
              { value: '5', label: '5' }
            ]}
          />
        </Row>
      </Section>

      <Section title={t('settings.capabilities')}>
        <Row label={t('settings.autoDiscard')} hint={t('settings.autoDiscardHint')}>
          <Toggle
            checked={settings.autoDiscardEnabled}
            onChange={(v) => set('autoDiscardEnabled', v)}
            ariaLabel={t('settings.autoDiscard')}
          />
        </Row>
        {settings.autoDiscardEnabled && (
          <Row label={t('settings.autoDiscardMinutes')}>
            <input
              type="number"
              min={5}
              max={240}
              value={settings.autoDiscardMinutes}
              onChange={(e) =>
                set('autoDiscardMinutes', Math.min(240, Math.max(5, Number(e.target.value) || 30)))
              }
              className="w-20 rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-800 outline-none focus:border-accent-500"
            />
          </Row>
        )}
        <Row label={t('settings.groupMode')}>
          <Select
            value={settings.groupMode}
            onChange={(v) => set('groupMode', v)}
            options={[
              { value: 'site', label: t('settings.groupModeSite') },
              { value: 'opener', label: t('settings.groupModeOpener') },
              { value: 'language', label: t('settings.groupModeLanguage') }
            ]}
          />
        </Row>
        <Row
          label={t('settings.autoGroupNative')}
          hint={t('settings.autoGroupNativeHint')}
        >
          <Toggle
            checked={settings.autoGroupNative}
            onChange={(v) => set('autoGroupNative', v)}
            ariaLabel={t('settings.autoGroupNative')}
          />
        </Row>
        <Row label={t('settings.undoStackLimit')} hint={t('settings.undoStackLimitHint')}>
          <Select
            value={String(settings.undoStackLimit)}
            onChange={(v) => set('undoStackLimit', Number(v))}
            options={[
              { value: '5', label: '5' },
              { value: '10', label: '10' },
              { value: '20', label: '20' },
              { value: '50', label: '50' }
            ]}
          />
        </Row>
        <Row label={t('settings.toastDuration')} hint={t('settings.toastDurationHint')}>
          <Select
            value={String(settings.toastDurationSec)}
            onChange={(v) => set('toastDurationSec', Number(v))}
            options={[
              { value: '3', label: '3s' },
              { value: '5', label: '5s' },
              { value: '7', label: '7s' },
              { value: '10', label: '10s' }
            ]}
          />
        </Row>
        <Row label={t('settings.keepPinnedInCleanup')} hint={t('settings.keepPinnedInCleanupHint')}>
          <Toggle
            checked={settings.keepPinnedInCleanup}
            onChange={(v) => set('keepPinnedInCleanup', v)}
            ariaLabel={t('settings.keepPinnedInCleanup')}
          />
        </Row>
        <Row label={t('settings.rowActionsVisible')} hint={t('settings.rowActionsVisibleHint')}>
          <Toggle
            checked={settings.rowActionsVisible}
            onChange={(v) => set('rowActionsVisible', v)}
            ariaLabel={t('settings.rowActionsVisible')}
          />
        </Row>
        <Row label={t('settings.pinyinSearch')} hint={t('settings.pinyinSearchHint')}>
          <Toggle
            checked={settings.pinyinSearch}
            onChange={(v) => set('pinyinSearch', v)}
            ariaLabel={t('settings.pinyinSearch')}
          />
        </Row>
        <Row label={t('settings.persistUndo')} hint={t('settings.persistUndoHint')}>
          <Toggle
            checked={settings.persistUndo}
            onChange={(v) => set('persistUndo', v)}
            ariaLabel={t('settings.persistUndo')}
          />
        </Row>
        <Row label={t('settings.uniqueUrlTabs')} hint={t('settings.uniqueUrlTabsHint')}>
          <Toggle
            checked={settings.uniqueUrlTabs}
            onChange={(v) => set('uniqueUrlTabs', v)}
            ariaLabel={t('settings.uniqueUrlTabs')}
          />
        </Row>
        <Row label={t('settings.preview')} hint={t('settings.previewDesc')}>
          <Toggle
            checked={settings.previewEnabled}
            onChange={(v) => set('previewEnabled', v)}
            ariaLabel={t('settings.preview')}
          />
        </Row>
      </Section>

      <Section title={t('settings.data')}>
        <Row label={t('settings.exportData')} hint={t('settings.exportDataHint')}>
          <button
            type="button"
            className="rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-800 hover:border-accent-500"
            onClick={handleExport}
          >
            {t('settings.export')}
          </button>
        </Row>
        <Row label={t('settings.importData')} hint={t('settings.importDataHint')}>
          <>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void handleImport(event)}
            />
            <button
              type="button"
              className="rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-800 hover:border-accent-500"
              onClick={() => importInputRef.current?.click()}
            >
              {t('settings.import')}
            </button>
          </>
        </Row>
        {transferStatus && (
          <output className="px-4 py-2 text-xs text-gray-600">
            {transferStatus}
          </output>
        )}
      </Section>
    </div>
  );
}
