import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { useDataStore } from '@/stores/dataStore';
import type { Settings } from '@/core/schema/models';
import { NO_CACHE_PATTERNS_LIMIT, normalizeNoCachePattern } from '@/platform/nocache/noCacheRules';
import { Button } from '@/ui/common/Button';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { FixedConceptsMap } from '@/ui/common/FixedConceptsMap';
import { Select } from '@/ui/common/Select';
import { TextField } from '@/ui/common/TextField';
import { Toggle } from '@/ui/common/Toggle';

type SidePanelSide = 'left' | 'right' | 'unknown';
type SidePanelLayoutApi = { getLayout?: () => Promise<{ side: 'left' | 'right' }> };

function SectionCount({ count }: { count?: number }) {
  if (count === undefined) return null;
  return (
    <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-2xs leading-none text-gray-500">
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
      <section className="mb-6 sm:mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-gray-600">
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
    <details className="group mb-6 sm:mb-8" open={forceOpen}>
      <summary className="mb-3 flex cursor-pointer items-center justify-between text-sm font-semibold tracking-wide text-gray-600 select-none">
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
    <div className="flex w-full flex-col items-end gap-1.5 sm:w-auto">
      {value.length > 0 && (
        <ul className="flex max-w-full flex-wrap justify-end gap-1 sm:max-w-[240px]">
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
                className="text-gray-500 hover:text-gray-600"
              >
                <Icon d={Icons.close} className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1">
        <TextField
          size="sm"
          className="w-32"
          placeholder={t('settings.whitelistPlaceholder')}
          ariaLabel={t('settings.whitelistPlaceholder')}
          value={input}
          onChange={setInput}
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
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="text-sm text-gray-800">{label}</div>
        {hint && <div className="mt-0.5 text-2xs text-gray-600">{hint}</div>}
      </div>
      {/* 窄屏下控件撑满整行（右对齐改为起始对齐，避免长文本域溢出） */}
      <div className="w-full shrink-0 sm:w-auto sm:pl-4">{children}</div>
    </div>
  );
}

/** 禁缓存站点编辑器：大文本框即列表（每行一条 pattern），所见即所得。
 *  编辑/删行直接改文本；失焦或点「保存」时按行归一化、去重写回设置，
 *  无效行被忽略并计数提示；外部变更（重置/导入）经 useEffect 回流同步。 */
function NoCachePatternEditor({
  value,
  onChange
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => value.join('\n'));
  const [invalidCount, setInvalidCount] = useState(0);
  /** 最近一次与设置对齐的文本（防「保存 → settings 回流 → 重置光标」循环）。 */
  const lastSyncedRef = useRef(value.join('\n'));
  const full = value.length >= NO_CACHE_PATTERNS_LIMIT;

  // 外部变更（重置设置 / 导入备份）同步进文本框；内容一致时跳过。
  useEffect(() => {
    const joined = value.join('\n');
    if (joined !== lastSyncedRef.current) {
      lastSyncedRef.current = joined;
      setText(joined);
    }
  }, [value]);

  const commit = () => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const next: string[] = [];
    let invalid = 0;
    for (const line of lines) {
      const normalized = normalizeNoCachePattern(line);
      if (!normalized) {
        invalid++;
        continue;
      }
      if (seen.has(normalized) || next.length >= NO_CACHE_PATTERNS_LIMIT) continue;
      seen.add(normalized);
      next.push(normalized);
    }
    setInvalidCount(invalid);
    const joined = next.join('\n');
    if (joined !== lastSyncedRef.current) {
      lastSyncedRef.current = joined;
      onChange(next);
    }
    // 文本框规整为归一化后的权威列表（无效行移除、空行压缩）。
    if (text !== joined) setText(joined);
  };

  return (
    <div className="flex w-full flex-col items-end gap-1 sm:w-96">
      <TextField
        multiline
        rows={5}
        resize
        className="font-mono leading-5"
        placeholder={t('settings.noCachePatternPlaceholder')}
        ariaLabel={t('settings.noCachePatterns')}
        inputProps={{ spellCheck: false }}
        value={text}
        onChange={(next) => {
          setText(next);
          if (invalidCount > 0) setInvalidCount(0);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          // ⌘/Ctrl+Enter 快捷保存（Enter 保持默认换行：列表编辑语义优先）
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          }
        }}
      />
      <div className="flex w-full items-center justify-between gap-2">
        <span className="min-w-0 truncate text-2xs text-gray-500">
          {invalidCount > 0
            ? t('settings.noCachePatternInvalidLines', { count: invalidCount })
            : t('settings.noCachePatternHelp')}
        </span>
        <Button variant="secondary" size="sm" onClick={commit}>
          {t('settings.noCachePatternSave')}
        </Button>
      </div>
      {full && <span className="text-2xs text-gray-500">{t('settings.noCachePatternFull')}</span>}
    </div>
  );
}

/** 禁缓存总开关：开启前请求 optional 全站 host 权限（拒绝则不开启）；权限被回收时引导重新授权。 */
function NoCacheToggle({
  settings,
  update
}: {
  settings: Settings;
  update: (key: keyof Settings, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [denied, setDenied] = useState(false);
  const [permissionLost, setPermissionLost] = useState(false);

  useEffect(() => {
    if (!settings.noCacheEnabled) {
      setPermissionLost(false);
      return;
    }
    let cancelled = false;
    void browser.permissions
      .contains({ origins: ['<all_urls>'] })
      .then((has) => {
        if (!cancelled) setPermissionLost(!has);
      })
      .catch(() => {
        if (!cancelled) setPermissionLost(true);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.noCacheEnabled]);

  const requestSiteAccess = () =>
    browser.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);

  const handleToggle = async (enabled: boolean) => {
    if (enabled) {
      // permissions.request 必须在用户手势内首发调用（Toggle onChange 满足）。
      const granted = await requestSiteAccess();
      if (!granted) {
        setDenied(true);
        return;
      }
      setDenied(false);
    }
    update('noCacheEnabled', enabled);
  };

  const regrant = async () => {
    const granted = await requestSiteAccess();
    if (granted) {
      setPermissionLost(false);
      setDenied(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Toggle
        checked={settings.noCacheEnabled}
        onChange={(enabled) => void handleToggle(enabled)}
        ariaLabel={t('settings.noCache')}
      />
      {denied && !settings.noCacheEnabled && (
        <span className="text-2xs text-red-600">{t('settings.noCachePermissionDenied')}</span>
      )}
      {permissionLost && settings.noCacheEnabled && (
        <span className="flex items-center gap-1.5 text-2xs text-warn-600">
          {t('settings.noCachePermissionLost')}
          <Button variant="secondary" size="sm" onClick={() => void regrant()}>
            {t('settings.noCachePermissionRegrant')}
          </Button>
        </span>
      )}
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
  | 'autoSaveSnapshots'
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
      /** 条件渲染：返回 false 时整行不显示（如依赖开关的子设置）。 */
      visible?: (settings: Settings) => boolean;
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
function SettingRow({
  spec,
  settings,
  update
}: {
  spec: SettingSpec;
  settings: Settings;
  update: (key: keyof Settings, value: unknown) => void;
}) {
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
          ariaLabel={label}
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

/** 主题色预设色板（与 main.css data-hue 预设一一对应，hex 取各预设浅色 500 主色）。 */
const COLOR_THEME_SWATCHES = [
  { id: 'forest', labelKey: 'settings.colorThemeForest', hex: '#347554' },
  { id: 'ocean', labelKey: 'settings.colorThemeOcean', hex: '#3a6ea8' },
  { id: 'violet', labelKey: 'settings.colorThemeViolet', hex: '#6f4ba6' },
  { id: 'sunset', labelKey: 'settings.colorThemeSunset', hex: '#b85f22' },
  { id: 'mono', labelKey: 'settings.colorThemeMono', hex: '#4a524a' },
  { id: 'plain', labelKey: 'settings.colorThemePlain', hex: '#80868b' }
] as const;

/** 预设画像：一键套用一组相关设置，降低 33 项设置的决策疲劳。 */
type PresetProfile = {
  id: 'researcher' | 'saver' | 'efficiency';
  nameKey: string;
  descKey: string;
  patch: Partial<Settings>;
};

const PRESET_PROFILES: PresetProfile[] = [
  {
    id: 'researcher',
    nameKey: 'presets.researcher',
    descKey: 'presets.researcherDesc',
    patch: {
      groupMode: 'site',
      aggregationThreshold: 2,
      sortMode: 'recency',
      pinyinSearch: true,
      searchAllWindows: false
    }
  },
  {
    id: 'saver',
    nameKey: 'presets.saver',
    descKey: 'presets.saverDesc',
    patch: { autoDiscardEnabled: true, autoDiscardMinutes: 30, discardNotifyEnabled: true }
  },
  {
    id: 'efficiency',
    nameKey: 'presets.efficiency',
    descKey: 'presets.efficiencyDesc',
    patch: {
      rowActionsVisible: true,
      closeOnMiddleClick: true,
      pinyinSearch: true,
      searchAllWindows: false
    }
  }
];

function PresetsPanel({ onApplied }: { onApplied: (message: string) => void }) {
  const { t } = useTranslation();
  const updateSettings = useDataStore((state) => state.updateSettings);
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-surface p-4 sm:mb-8">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">{t('presets.title')}</h2>
      <p className="mb-3 text-2xs text-gray-600">{t('presets.hint')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PRESET_PROFILES.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="flex flex-col items-start gap-1 rounded-lg border border-control bg-surface px-3 py-2 text-left transition-base hover:border-accent-400 hover:bg-accent-50"
            onClick={() => {
              void updateSettings(preset.patch);
              onApplied(t('presets.applied', { name: t(preset.nameKey) }));
            }}
          >
            <span className="text-sm font-medium text-gray-800">{t(preset.nameKey)}</span>
            <span className="text-2xs leading-snug text-gray-600">{t(preset.descKey)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** 能力发现清单：用图标 + 一句话 +「试用」把藏得深的能力推到用户面前。 */
const CAPABILITIES = [
  { icon: Icons.menu, titleKey: 'cap.contextMenuTitle', howKey: 'cap.contextMenuHow' },
  { icon: Icons.search, titleKey: 'cap.omniboxTitle', howKey: 'cap.omniboxHow' },
  { icon: Icons.shortcuts, titleKey: 'cap.paletteTitle', howKey: 'cap.paletteHow' },
  { icon: Icons.pin, titleKey: 'cap.pinTitle', howKey: 'cap.pinHow' },
  { icon: Icons.snapshot, titleKey: 'cap.snapshotTitle', howKey: 'cap.snapshotHow' },
  { icon: Icons.history, titleKey: 'cap.undoTitle', howKey: 'cap.undoHow' }
] as const;

function CapabilitiesGuide() {
  const { t } = useTranslation();
  return (
    <Section title={t('settings.capabilitiesGuide')}>
      <div className="divide-y divide-gray-100">
        {CAPABILITIES.map((cap) => (
          <div key={cap.titleKey} className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600">
              <Icon d={cap.icon} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800">{t(cap.titleKey)}</p>
              <p className="mt-0.5 text-2xs leading-snug text-gray-600">{t(cap.howKey)}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void (async () => {
                  try {
                    const win = await browser.windows.getCurrent();
                    if (win.id !== undefined) await browser.sidePanel.open({ windowId: win.id });
                  } catch {
                    /* 侧边栏打开失败不阻断设置页 */
                  }
                })();
              }}
            >
              {t('settings.capTry')}
            </Button>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * 构建设置分组配置（声明式描述设置行，渲染由 SettingRow 统一完成）。
 *
 * 放在模块顶层而非常量/组件内：配置约 370 行，含大量 t() 调用与 render 闭包。
 * 配置体量大且含大量 t() 调用，故按依赖参数化后由组件 memo 调用。
 * 现在按依赖参数化（t 与 sidePanelSide 是运行时值），由组件调用一次即可。
 */
function buildSections(
  t: (key: string, options?: Record<string, unknown>) => string,
  sidePanelSide: string
): { titleKey: string; collapsible?: boolean; specs: SettingSpec[] }[] {
  return [
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
          kind: 'custom',
          labelKey: 'settings.colorTheme',
          hintKey: 'settings.colorThemeHint',
          render: ({ settings, update, t }) => (
            <div
              className="flex items-center gap-1.5"
              role="radiogroup"
              aria-label={t('settings.colorTheme')}
            >
              {COLOR_THEME_SWATCHES.map((swatch) => (
                <input
                  key={swatch.id}
                  type="radio"
                  name="colorTheme"
                  checked={settings.colorTheme === swatch.id}
                  title={t(swatch.labelKey)}
                  aria-label={t(swatch.labelKey)}
                  /* 样式走 .theme-swatch：视觉 20px / 命中 24px，
                     选中态为「白色内环 + 品牌外环」双层（旧版 gray-500 外环
                     落在不同色块上仅 1.02–1.77:1，sunset 上几乎不可见）。 */
                  className="theme-swatch appearance-none"
                  style={{ backgroundColor: swatch.hex }}
                  onChange={() => update('colorTheme', swatch.id)}
                />
              ))}
            </div>
          )
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
            <span className="rounded border border-gray-200 bg-surface px-2 py-1 text-xs text-gray-600">
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
        {
          kind: 'toggle',
          key: 'showUrl',
          labelKey: 'settings.showUrl',
          hintKey: 'settings.showUrlHint'
        },
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
          // settings 来自 SettingRow 注入的 render 参数（配置已外提为模块级函数，
          // 不能再捕获组件作用域的 settings 变量）。
          render: ({ settings: currentSettings, update, t }) => (
            <Select
              value={currentSettings.language ?? 'zh-CN'}
              onChange={(v) => update('language', v)}
              options={[
                { value: 'zh-CN', label: '简体中文' },
                { value: 'en', label: 'English' }
              ]}
              ariaLabel={t('settings.language')}
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
          render: ({ settings, update, t }) => (
            <TextField
              type="number"
              size="sm"
              className="w-20"
              min={5}
              max={240}
              value={String(settings.autoDiscardMinutes)}
              ariaLabel={t('settings.autoDiscardMinutes')}
              onChange={(next) =>
                update('autoDiscardMinutes', Math.min(240, Math.max(5, Number(next) || 30)))
              }
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
          kind: 'custom',
          labelKey: 'settings.noCache',
          hintKey: 'settings.noCacheHint',
          render: ({ settings, update }) => <NoCacheToggle settings={settings} update={update} />
        },
        {
          kind: 'custom',
          labelKey: 'settings.noCachePatterns',
          hintKey: 'settings.noCachePatternsHint',
          visible: (s) => s.noCacheEnabled,
          render: ({ settings, update }) => (
            <NoCachePatternEditor
              value={settings.noCachePatterns}
              onChange={(next) => update('noCachePatterns', next)}
            />
          )
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
        },
        {
          kind: 'toggle',
          key: 'autoSaveSnapshots',
          labelKey: 'settings.autoSaveSnapshots',
          hintKey: 'settings.autoSaveSnapshotsHint'
        },
        {
          kind: 'select',
          key: 'maxAutoSnapshots',
          labelKey: 'settings.maxAutoSnapshots',
          hintKey: 'settings.maxAutoSnapshotsHint',
          visible: (s) => s.autoSaveSnapshots,
          parse: (v) => Number(v),
          options: [
            { value: '5', label: '5' },
            { value: '10', label: '10' },
            { value: '20', label: '20' },
            { value: '30', label: '30' },
            { value: '50', label: '50' }
          ]
        }
      ]
    }
  ];
}

/**
 * 平台修饰键判定：Mac 用户应看到 ⌃⇧ 而非 Ctrl+Shift。
 * 模块顶层常量：navigator.platform 每次渲染求值且该 API 已废弃，
 * 结果在会话内不会变化，无理由反复读取。
 */
const IS_MAC = /mac/i.test(globalThis.navigator?.platform ?? '');

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

  // 分组配置见模块顶层的 buildSections。此处再 memo 一层：配置约 370 行且含大量
  // t() 调用，若每次渲染重建，每敲一个搜索字符都会全量重算翻译与 render 闭包。
  // 必须在下面的 early return 之前调用（Hooks 规则：调用顺序须每次渲染一致）。
  const sections = useMemo(() => buildSections(t, sidePanelSide), [t, sidePanelSide]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10 text-sm text-gray-500">
        {t('settings.loading')}
      </div>
    );
  }

  const isSearching = settingsSearch.trim().length > 0;

  const matchesSearch = (spec: SettingSpec): boolean => {
    if (!isSearching) return true;
    const q = settingsSearch.trim().toLowerCase();
    const label = t(spec.labelKey).toLowerCase();
    const hint = spec.kind !== 'custom' && spec.hintKey ? t(spec.hintKey).toLowerCase() : '';
    return label.includes(q) || hint.includes(q) || spec.labelKey.toLowerCase().includes(q);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-4 flex items-start justify-between gap-3 sm:mb-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gray-200 bg-surface shadow-sm">
            <Icon d={Icons.settings} className="h-4.5 w-4.5 text-accent-600" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{t('settings.title')}</h1>
            <p className="mt-0.5 text-2xs text-gray-600">{t('settings.subtitle')}</p>
          </div>
        </div>
        <Button variant="danger-ghost" onClick={() => setConfirmingReset(true)}>
          {t('settings.resetAll')}
        </Button>
      </header>

      <div className="mb-6">
        <TextField
          type="search"
          size="lg"
          className="rounded-lg shadow-sm"
          value={settingsSearch}
          onChange={setSettingsSearch}
          placeholder={t('settings.searchPlaceholder')}
          ariaLabel={t('settings.searchPlaceholder')}
        />
      </div>

      <PresetsPanel onApplied={setTransferStatus} />

      <CapabilitiesGuide />

      <Section title={t('fixedMap.title')}>
        <div className="p-4">
          <FixedConceptsMap />
        </div>
      </Section>

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
        {/* 浏览器命令快捷键按平台渲染修饰键：mac 显示 ⌃⇧ 符号，Windows/Linux 显示 Ctrl+Shift 文案 */}
        {(
          [
            ['F', t('settings.shortcutFocusSearch')],
            ['O', t('settings.shortcutOpenPanel')],
            ['L', t('settings.shortcutLocateActive')],
            ['U', t('settings.shortcutDiscardInactive')]
          ] as const
        ).map(([key, hint]) => (
          <Row key={key} label={IS_MAC ? `⌃⇧${key}` : `Ctrl+Shift+${key}`} hint={hint}>
            <span className="text-2xs text-gray-500">{t('settings.shortcutBrowser')}</span>
          </Row>
        ))}
        <Row label="⌘K / Ctrl+K" hint={t('settings.shortcutPanelSearch')}>
          <span className="text-2xs text-gray-500">{t('settings.shortcutPanel')}</span>
        </Row>
        <Row label="⌘J / Ctrl+J" hint={t('settings.shortcutLocatePanel')}>
          <span className="text-2xs text-gray-500">{t('settings.shortcutPanel')}</span>
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
          <output className="px-4 py-2 text-xs text-gray-600">{transferStatus}</output>
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
