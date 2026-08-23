import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { useDataStore } from '@/stores/dataStore';
import type { Settings } from '@/core/schema/models';
import { Button } from '@/ui/common/Button';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { Select } from '@/ui/common/Select';
import { Toggle } from '@/ui/common/Toggle';

type SidePanelSide = 'left' | 'right' | 'unknown';
type SidePanelLayoutApi = { getLayout?: () => Promise<{ side: 'left' | 'right' }> };

/** 分区标题计数徽章。 */
function SectionCount({ count }: { count?: number }) {
  if (count === undefined) return null;
  return (
    <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-2xs leading-none text-gray-400">
      {count}
    </span>
  );
}

/** 设置分区：collapsible 时折叠为「高级设置」抽屉（details/summary）；forceOpen 用于搜索时展开。 */
function Section({
  title,
  children,
  collapsible = false,
  count,
  forceOpen
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  count?: number;
  /** 搜索时强制展开折叠分区；缺省不传保持非受控。 */
  forceOpen?: boolean;
}) {
  if (!collapsible) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          <span>{title}</span>
          <SectionCount count={count} />
        </h2>
        <div className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200 bg-surface">
          {children}
        </div>
      </section>
    );
  }
  return (
    <details className="group mb-8" open={forceOpen}>
      <summary className="mb-3 flex cursor-pointer items-center justify-between text-sm font-semibold uppercase tracking-wide text-gray-500 select-none">
        <span className="flex items-center gap-2">
          {title}
          <SectionCount count={count} />
        </span>
        <Icon d={Icons.chevron} className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <div className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200 bg-surface">
        {children}
      </div>
    </details>
  );
}

/** 休眠白名单编辑器：输入域名 → 添加；chip 列表可单个删除。 */
function WhitelistEditor({
  value,
  onChange
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const add = () => {
    const host = input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
    if (!host) return;
    if (!value.includes(host)) onChange([...value, host]);
    setInput('');
  };
  return (
    <div className="flex flex-col items-end gap-1.5">
      {value.length > 0 && (
        <ul className="flex max-w-[240px] flex-wrap justify-end gap-1">
          {value.map((entry) => (
            <li
              key={entry}
              className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-2xs text-gray-600"
            >
              {entry}
              <button
                type="button"
                aria-label={t('settings.whitelistRemove')}
                title={t('settings.whitelistRemove')}
                onClick={() => onChange(value.filter((v) => v !== entry))}
                className="text-gray-400 hover:text-gray-600"
              >
                <Icon d={Icons.close} className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1">
        <input
          type="text"
          className="w-32 rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-800 outline-none focus:border-accent-500"
          placeholder={t('settings.whitelistPlaceholder')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <Button variant="secondary" size="sm" onClick={add}>
          {t('settings.whitelistAdd')}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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

/** Settings 中类型为 boolean 的键（Toggle 行专用）。 */
type BooleanSettingKey =
  | 'tabOrderSync'
  | 'showPinnedStrip'
  | 'showUrl'
  | 'showSplitBadges'
  | 'autoScrollActive'
  | 'closeOnMiddleClick'
  | 'autoDiscardEnabled'
  | 'autoGroupNative'
  | 'rowActionsVisible'
  | 'pinyinSearch'
  | 'persistUndo'
  | 'uniqueUrlTabs'
  | 'searchAllWindows'
  | 'discardNotifyEnabled'
  | 'reuseNotifyEnabled'
  | 'contextMenusEnabled'
  | 'omniboxEnabled';

interface SettingRowContext {
  settings: Settings;
  update: (key: keyof Settings, value: unknown) => void;
  t: (key: string) => string;
}

/** 设置行声明（配置化渲染，消灭手写重复的 Row+Toggle/Select 组合）。 */
type SettingSpec =
  | {
      kind: 'toggle';
      key: BooleanSettingKey;
      labelKey: string;
      hintKey?: string;
      /** 关闭开关时的确认文案 key；用户取消则不更新。 */
      confirmOffKey?: string;
    }
  | {
      kind: 'select';
      key: keyof Settings;
      labelKey: string;
      hintKey?: string;
      options: { value: string; label: string }[];
      /** select 值 → 设置值（默认按字符串直传）。 */
      parse?: (value: string) => unknown;
      /** 条件渲染：返回 false 时整行不显示（如依赖开关的子设置）。 */
      visible?: (settings: Settings) => boolean;
    }
  | {
      kind: 'custom';
      labelKey: string;
      hintKey?: string;
      /** 条件渲染：返回 false 时整行不显示（如依赖开关的子设置）。 */
      visible?: (settings: Settings) => boolean;
      render: (ctx: SettingRowContext) => ReactNode;
    };

/** 按 spec 渲染单个设置行（行容器/控件/翻译统一在此收敛）。 */
function SettingRow({ spec, settings, update }: { spec: SettingSpec; settings: Settings; update: (key: keyof Settings, value: unknown) => void }) {
  const { t } = useTranslation();
  const label = t(spec.labelKey);
  const hint = spec.kind !== 'custom' && spec.hintKey ? t(spec.hintKey) : undefined;
  // 关闭带确认的开关时，用项目自制的 ConfirmDialog（focus trap + Esc）而非浏览器原生 confirm。
  const [confirmingKey, setConfirmingKey] = useState<BooleanSettingKey | null>(null);

  if (spec.kind === 'toggle') {
    return (
      <>
        <Row label={label} hint={hint}>
          <Toggle
            checked={settings[spec.key] as boolean}
            onChange={(v) => {
              if (!v && spec.confirmOffKey) {
                setConfirmingKey(spec.key);
                return;
              }
              update(spec.key, v);
            }}
            ariaLabel={label}
          />
        </Row>
        {confirmingKey === spec.key && spec.confirmOffKey && (
          <ConfirmDialog
            title={t('dialog.confirmTitle')}
            message={t(spec.confirmOffKey)}
            danger
            onCancel={() => setConfirmingKey(null)}
            onConfirm={() => {
              update(spec.key, false);
              setConfirmingKey(null);
            }}
          />
        )}
      </>
    );
  }

  if (spec.kind === 'select') {
    return (
      <Row label={label} hint={hint}>
        <Select
          value={String(settings[spec.key])}
          onChange={(v) => update(spec.key, spec.parse ? spec.parse(v) : v)}
          options={spec.options}
        />
      </Row>
    );
  }

  return (
    <Row label={label} hint={spec.hintKey ? t(spec.hintKey) : undefined}>
      {spec.render({ settings, update, t })}
    </Row>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useDataStore((state) => state.settings);
  const ready = useDataStore((state) => state.ready);
  const updateSettings = useDataStore((state) => state.updateSettings);
  const resetSettings = useDataStore((state) => state.resetSettings);
  const exportData = useDataStore((state) => state.exportData);
  const importData = useDataStore((state) => state.importData);
  const importBookmarksFromBar = useDataStore((state) => state.importBookmarksFromBar);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [sidePanelSide, setSidePanelSide] = useState<SidePanelSide>('unknown');
  /** 已解析待导入的备份数据（非 null 时显示导入确认弹窗）。 */
  const [pendingImport, setPendingImport] = useState<unknown>(null);
  /** 设置项搜索：匹配分区内 label/hint 文案。 */
  const [settingsSearch, setSettingsSearch] = useState('');
  /** 恢复默认设置的确认弹窗。 */
  const [confirmingReset, setConfirmingReset] = useState(false);

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

  const update = (key: keyof Settings, value: unknown) =>
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
      // 先解析，确认弹窗由自制 ConfirmDialog 承接（与全站弹窗体系一致）。
      setPendingImport(JSON.parse(await file.text()) as unknown);
    } catch {
      setTransferStatus(t('settings.importFailed'));
    }
  };

  const runImport = () => {
    if (pendingImport === null) return;
    void importData(pendingImport)
      .then(() => setTransferStatus(t('settings.importSuccess')))
      .catch(() => setTransferStatus(t('settings.importFailed')));
    setPendingImport(null);
  };

  const handleImportBookmarks = () => {
    void importBookmarksFromBar()
      .then((result) =>
        setTransferStatus(
          t('settings.importBookmarksDone', {
            folders: result.foldersCreated,
            items: result.itemsImported
          })
        )
      )
      .catch(() => setTransferStatus(t('settings.importFailed')));
  };

  /** 打开浏览器「扩展快捷键」设置页。 */
  const openShortcutSettings = () => {
    void browser.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {});
  };

  /** 恢复全部设置为默认值（带确认弹窗）。 */
  const handleResetSettings = () => {
    void resetSettings()
      .then(() => setTransferStatus(t('settings.resetDone')))
      .catch(() => setTransferStatus(t('settings.resetFailed')));
    setConfirmingReset(false);
  };

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-6 py-10 text-sm text-gray-500">{t('settings.loading')}</div>;
  }

  /** 分组配置：声明式描述设置行，渲染由 SettingRow 统一完成。 */
  const sections: { titleKey: string; collapsible?: boolean; specs: SettingSpec[] }[] = [
    {
      titleKey: 'settings.appearance',
      specs: [
        {
          kind: 'select',
          key: 'themePreference',
          labelKey: 'settings.theme',
          options: [
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') }
          ]
        },
        {
          kind: 'toggle',
          key: 'showPinnedStrip',
          labelKey: 'settings.showPinnedStrip',
          hintKey: 'settings.showPinnedStripHint'
        },
        {
          kind: 'custom',
          labelKey: 'settings.sidePanelPosition',
          hintKey: 'settings.sidePanelPositionHint',
          render: () => (
            <span className="rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-600">
              {sidePanelSide === 'left'
                ? t('settings.sidePanelPositionLeft')
                : sidePanelSide === 'right'
                  ? t('settings.sidePanelPositionRight')
                  : t('settings.sidePanelPositionUnknown')}
            </span>
          )
        },
        {
          kind: 'select',
          key: 'density',
          labelKey: 'settings.density',
          options: [
            { value: 'compact', label: t('settings.densityCompact') },
            { value: 'cozy', label: t('settings.densityCozy') }
          ]
        },
        { kind: 'toggle', key: 'showUrl', labelKey: 'settings.showUrl', hintKey: 'settings.showUrlHint' },
        {
          kind: 'toggle',
          key: 'showSplitBadges',
          labelKey: 'settings.showSplitBadges',
          hintKey: 'settings.showSplitBadgesHint'
        },
        {
          kind: 'select',
          key: 'pinnedStripSize',
          labelKey: 'settings.pinnedStripSize',
          hintKey: 'settings.pinnedStripSizeHint',
          options: [
            { value: 'sm', label: t('settings.pinnedStripSizeSm') },
            { value: 'md', label: t('settings.pinnedStripSizeMd') },
            { value: 'lg', label: t('settings.pinnedStripSizeLg') }
          ]
        },
        {
          kind: 'select',
          key: 'groupAccentStyle',
          labelKey: 'settings.groupAccentStyle',
          hintKey: 'settings.groupAccentStyleHint',
          options: [
            { value: 'auto', label: t('settings.groupAccentAuto') },
            { value: 'mono', label: t('settings.groupAccentMono') }
          ]
        }
      ]
    },
    {
      titleKey: 'settings.behavior',
      specs: [
        {
          kind: 'custom',
          labelKey: 'settings.language',
          render: ({ update }) => (
            <Select
              value={settings.language ?? 'zh-CN'}
              onChange={(v) => update('language', v)}
              options={[
                { value: 'zh-CN', label: '简体中文' },
                { value: 'en', label: 'English' }
              ]}
            />
          )
        },
        {
          kind: 'select',
          key: 'newTabPosition',
          labelKey: 'settings.newTabPosition',
          hintKey: 'settings.newTabPositionHint',
          options: [
            { value: 'end', label: t('settings.newTabEnd') },
            { value: 'after-active', label: t('settings.newTabAfterActive') }
          ]
        },
        {
          kind: 'toggle',
          key: 'autoScrollActive',
          labelKey: 'settings.autoScrollActive',
          hintKey: 'settings.autoScrollActiveHint'
        },
        {
          kind: 'toggle',
          key: 'closeOnMiddleClick',
          labelKey: 'settings.closeOnMiddleClick',
          hintKey: 'settings.closeOnMiddleClickHint'
        },
        {
          kind: 'select',
          key: 'sortMode',
          labelKey: 'settings.sortMode',
          options: [
            { value: 'browser', label: t('settings.sortBrowser') },
            { value: 'recency', label: t('settings.sortRecency') }
          ]
        },
        {
          kind: 'toggle',
          key: 'tabOrderSync',
          labelKey: 'settings.tabOrderSync',
          hintKey: 'settings.tabOrderSyncHint'
        },
        {
          kind: 'select',
          key: 'aggregationThreshold',
          labelKey: 'settings.threshold',
          hintKey: 'settings.thresholdHint',
          parse: (v) => Number(v),
          options: [
            { value: '1', label: t('settings.thresholdOne') },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
            { value: '4', label: '4' },
            { value: '5', label: '5' }
          ]
        }
      ]
    },
    {
      titleKey: 'settings.capabilities',
      specs: [
        {
          kind: 'toggle',
          key: 'autoDiscardEnabled',
          labelKey: 'settings.autoDiscard',
          hintKey: 'settings.autoDiscardHint'
        },
        {
          kind: 'custom',
          labelKey: 'settings.autoDiscardMinutes',
          visible: (s) => s.autoDiscardEnabled,
          render: ({ settings, update }) => (
            <input
              type="number"
              min={5}
              max={240}
              value={settings.autoDiscardMinutes}
              onChange={(e) =>
                update('autoDiscardMinutes', Math.min(240, Math.max(5, Number(e.target.value) || 30)))
              }
              className="w-20 rounded border border-gray-300 bg-surface px-2 py-1 text-xs text-gray-800 outline-none focus:border-accent-500"
            />
          )
        },
        {
          kind: 'custom',
          labelKey: 'settings.discardWhitelist',
          hintKey: 'settings.discardWhitelistHint',
          render: ({ settings, update }) => (
            <WhitelistEditor
              value={settings.discardWhitelist}
              onChange={(next) => update('discardWhitelist', next)}
            />
          )
        },
        {
          kind: 'toggle',
          key: 'searchAllWindows',
          labelKey: 'settings.searchAllWindows',
          hintKey: 'settings.searchAllWindowsHint'
        },
        {
          kind: 'select',
          key: 'groupMode',
          labelKey: 'settings.groupMode',
          options: [
            { value: 'site', label: t('settings.groupModeSite') },
            { value: 'opener', label: t('settings.groupModeOpener') },
            { value: 'language', label: t('settings.groupModeLanguage') }
          ]
        },
        {
          kind: 'toggle',
          key: 'autoGroupNative',
          labelKey: 'settings.autoGroupNative',
          hintKey: 'settings.autoGroupNativeHint',
          confirmOffKey: 'settings.autoGroupNativeDisableConfirm'
        },
        {
          kind: 'toggle',
          key: 'uniqueUrlTabs',
          labelKey: 'settings.uniqueUrlTabs',
          hintKey: 'settings.uniqueUrlTabsHint'
        },
        {
          kind: 'toggle',
          key: 'discardNotifyEnabled',
          labelKey: 'settings.discardNotify',
          hintKey: 'settings.discardNotifyHint'
        },
        {
          kind: 'toggle',
          key: 'reuseNotifyEnabled',
          labelKey: 'settings.reuseNotify',
          hintKey: 'settings.reuseNotifyHint'
        },
        {
          kind: 'select',
          key: 'badgeMode',
          labelKey: 'settings.badgeMode',
          hintKey: 'settings.badgeModeHint',
          options: [
            { value: 'auto', label: t('settings.badgeAuto') },
            { value: 'count', label: t('settings.badgeCount') },
            { value: 'dups', label: t('settings.badgeDups') },
            { value: 'off', label: t('settings.badgeOff') }
          ]
        },
        {
          kind: 'toggle',
          key: 'contextMenusEnabled',
          labelKey: 'settings.contextMenus',
          hintKey: 'settings.contextMenusHint'
        },
        {
          kind: 'toggle',
          key: 'omniboxEnabled',
          labelKey: 'settings.omnibox',
          hintKey: 'settings.omniboxHint'
        },
        {
          kind: 'select',
          key: 'undoStackLimit',
          labelKey: 'settings.undoStackLimit',
          hintKey: 'settings.undoStackLimitHint',
          parse: (v) => Number(v),
          options: [
            { value: '5', label: '5' },
            { value: '10', label: '10' },
            { value: '20', label: '20' },
            { value: '50', label: '50' }
          ]
        },
        {
          kind: 'select',
          key: 'toastDurationSec',
          labelKey: 'settings.toastDuration',
          hintKey: 'settings.toastDurationHint',
          parse: (v) => Number(v),
          options: [
            { value: '3', label: '3s' },
            { value: '5', label: '5s' },
            { value: '7', label: '7s' },
            { value: '10', label: '10s' }
          ]
        },
        {
          kind: 'toggle',
          key: 'rowActionsVisible',
          labelKey: 'settings.rowActionsVisible',
          hintKey: 'settings.rowActionsVisibleHint'
        },
        {
          kind: 'toggle',
          key: 'pinyinSearch',
          labelKey: 'settings.pinyinSearch',
          hintKey: 'settings.pinyinSearchHint'
        },
        {
          kind: 'toggle',
          key: 'persistUndo',
          labelKey: 'settings.persistUndo',
          hintKey: 'settings.persistUndoHint'
        }
      ]
    }
  ];

  const isSearching = settingsSearch.trim().length > 0;
  const matchesSearch = (spec: SettingSpec): boolean => {
    if (!isSearching) return true;
    const q = settingsSearch.trim().toLowerCase();
    const label = t(spec.labelKey).toLowerCase();
    const hint = spec.kind !== 'custom' && spec.hintKey ? t(spec.hintKey).toLowerCase() : '';
    return label.includes(q) || hint.includes(q) || spec.labelKey.toLowerCase().includes(q);
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gray-200 bg-surface shadow-sm">
            <Icon d={Icons.settings} className="h-4.5 w-4.5 text-accent-600" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{t('settings.title')}</h1>
            <p className="mt-0.5 text-2xs text-gray-500">{t('settings.subtitle')}</p>
          </div>
        </div>
        <Button variant="danger-ghost" onClick={() => setConfirmingReset(true)}>
          {t('settings.resetAll')}
        </Button>
      </header>

      <div className="mb-6">
        <input
          type="search"
          value={settingsSearch}
          onChange={(event) => setSettingsSearch(event.target.value)}
          placeholder={t('settings.searchPlaceholder')}
          className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm text-gray-800 shadow-sm outline-none focus:border-accent-500"
          aria-label={t('settings.searchPlaceholder')}
        />
      </div>

      {sections.map((section) => {
        const specs = section.specs
          .filter((spec) => ('visible' in spec && spec.visible ? spec.visible(settings) : true))
          .filter(matchesSearch);
        if (specs.length === 0) return null;
        return (
          <Section
            key={section.titleKey}
            title={t(section.titleKey)}
            collapsible={section.collapsible}
            count={specs.length}
            forceOpen={isSearching}
          >
            {specs.map((spec) => (
              <SettingRow key={spec.labelKey} spec={spec} settings={settings} update={update} />
            ))}
          </Section>
        );
      })}

      <Section title={t('settings.shortcuts')}>
        <Row label="Ctrl+Shift+F" hint={t('settings.shortcutFocusSearch')}>
          <span className="text-2xs text-gray-400">{t('settings.shortcutBrowser')}</span>
        </Row>
        <Row label="Ctrl+Shift+O" hint={t('settings.shortcutOpenPanel')}>
          <span className="text-2xs text-gray-400">{t('settings.shortcutBrowser')}</span>
        </Row>
        <Row label="Ctrl+Shift+L" hint={t('settings.shortcutLocateActive')}>
          <span className="text-2xs text-gray-400">{t('settings.shortcutBrowser')}</span>
        </Row>
        <Row label="Ctrl+Shift+U" hint={t('settings.shortcutDiscardInactive')}>
          <span className="text-2xs text-gray-400">{t('settings.shortcutBrowser')}</span>
        </Row>
        <Row label="⌘K / Ctrl+K" hint={t('settings.shortcutPanelSearch')}>
          <span className="text-2xs text-gray-400">{t('settings.shortcutPanel')}</span>
        </Row>
        <Row label="⌘J / Ctrl+J" hint={t('settings.shortcutLocatePanel')}>
          <span className="text-2xs text-gray-400">{t('settings.shortcutPanel')}</span>
        </Row>
        <Row label={t('settings.shortcutCustomize')} hint={t('settings.shortcutCustomizeHint')}>
          <Button variant="secondary" onClick={openShortcutSettings}>
            {t('settings.shortcutCustomizeAction')}
          </Button>
        </Row>
      </Section>

      <Section title={t('settings.data')}>
        <Row label={t('settings.exportData')} hint={t('settings.exportDataHint')}>
          <Button variant="secondary" onClick={handleExport}>
            {t('settings.export')}
          </Button>
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
            <Button variant="secondary" onClick={() => importInputRef.current?.click()}>
              {t('settings.import')}
            </Button>
          </>
        </Row>
        <Row label={t('settings.importBookmarks')} hint={t('settings.importBookmarksHint')}>
          <Button variant="secondary" onClick={handleImportBookmarks}>
            {t('settings.importBookmarksAction')}
          </Button>
        </Row>
        {transferStatus && (
          <output className="px-4 py-2 text-xs text-gray-600">
            {transferStatus}
          </output>
        )}
      </Section>

      {pendingImport !== null && (
        <ConfirmDialog
          title={t('dialog.confirmTitle')}
          message={t('settings.importConfirm')}
          danger
          onCancel={() => setPendingImport(null)}
          onConfirm={runImport}
        />
      )}

      {confirmingReset && (
        <ConfirmDialog
          title={t('dialog.confirmTitle')}
          message={t('settings.resetConfirm')}
          danger
          onCancel={() => setConfirmingReset(false)}
          onConfirm={handleResetSettings}
        />
      )}
    </div>
  );
}
