import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { Settings } from '@/core/schema/models';
import { COLOR_THEMES, type ColorTheme } from '@/core/theme/colorThemes';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { Select } from '@/ui/common/Select';
import { TextField } from '@/ui/common/TextField';
import { Toggle } from '@/ui/common/Toggle';
import {
  NoCachePatternEditor,
  NoCacheToggle,
  Row,
  WhitelistEditor
} from '@/entrypoints/options/settingControls';

/**
 * 设置页的**配置层**：声明式描述设置行（`buildSections`）与统一渲染器（`SettingRow`）。
 *
 * 与 `settingControls.tsx`（展示层控件）分层的原因见该文件头注释 —— render 闭包
 * 引用编辑器组件，同文件会成环。本文件只被 `SettingsPage.tsx` 引用。
 */

/** Settings 中类型为 boolean 的键（Toggle 行专用）。 */
export type BooleanSettingKey =
  | 'tabOrderSync'
  | 'showPinnedStrip'
  | 'showUrl'
  | 'showSplitBadges'
  | 'autoScrollActive'
  | 'closeOnMiddleClick'
  | 'autoDiscardEnabled'
  | 'autoGroupNative'
  | 'rowActionsVisible'
  | 'footerLabels'
  | 'pinyinSearch'
  | 'persistUndo'
  | 'autoSaveSnapshots'
  | 'uniqueUrlTabs'
  | 'searchAllWindows'
  | 'discardNotifyEnabled'
  | 'reuseNotifyEnabled'
  | 'contextMenusEnabled'
  | 'omniboxEnabled';

export interface SettingRowContext {
  settings: Settings;
  update: (key: keyof Settings, value: unknown) => void;
  t: (key: string) => string;
}

/** 设置行声明（配置化渲染，消灭手写重复的 Row+Toggle/Select 组合）。 */
export type SettingSpec =
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
export function SettingRow({
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

/**
 * 色号 → 展示文案。色值取自 `@/core/theme/colorThemes` 的唯一来源，此处只补 UI 文案。
 * 用 `Record<ColorTheme, string>` 约束，新增色号时漏配文案会直接编译报错。
 */
const COLOR_THEME_LABELS: Record<ColorTheme, string> = {
  forest: 'settings.colorThemeForest',
  ocean: 'settings.colorThemeOcean',
  violet: 'settings.colorThemeViolet',
  sunset: 'settings.colorThemeSunset',
  mono: 'settings.colorThemeMono',
  plain: 'settings.colorThemePlain'
};

/**
 * 构建设置分组配置（声明式描述设置行，渲染由 SettingRow 统一完成）。
 *
 * 放在模块顶层而非常量/组件内：配置约 370 行，含大量 t() 调用与 render 闭包。
 * 配置体量大且含大量 t() 调用，故按依赖参数化后由组件 memo 调用。
 * 现在按依赖参数化（t 与 sidePanelSide 是运行时值），由组件调用一次即可。
 */
export function buildSections(
  t: (key: string, options?: Record<string, unknown>) => string,
  sidePanelSide: string
): { titleKey: string; specs: SettingSpec[] }[] {
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
              {COLOR_THEMES.map((swatch) => (
                <input
                  key={swatch.id}
                  type="radio"
                  name="colorTheme"
                  checked={settings.colorTheme === swatch.id}
                  title={t(COLOR_THEME_LABELS[swatch.id])}
                  aria-label={t(COLOR_THEME_LABELS[swatch.id])}
                  /* 样式走 .theme-swatch：视觉 20px / 命中 24px，
                     选中态为「白色内环 + 品牌外环」双层（gray-500 外环
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
            { value: 'cozy', label: t('settings.densityCozy') },
            { value: 'large', label: t('settings.densityLarge') }
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
          key: 'footerLabels',
          labelKey: 'settings.footerLabels',
          hintKey: 'settings.footerLabelsHint'
        },
        {
          kind: 'toggle',
          key: 'showSplitBadges',
          labelKey: 'settings.showSplitBadges',
          hintKey: 'settings.showSplitBadgesHint'
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
              // 显示值必须与「实际生效语言」一致：settings.language 缺省时界面语言
              // 由浏览器语言决定（i18n 初始化），此前硬编码兜底 'zh-CN' 会让英文
              // 环境的用户看到下拉框显示「简体中文」而界面实为英文。
              // 运行时 i18n.language 已被 SettingsSync 对齐为设置值，两者互补。
              value={currentSettings.language ?? i18n.language}
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
          hintKey: 'settings.sortModeHint',
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
      // P0-3：原 21 项「进阶功能」平铺区按语义三分（休眠与内存 / 分组与搜索 / 高级与恢复），
      // 低频的「高级与恢复」默认折叠（collapsible），搜索时由 forceOpen 自动展开。
      titleKey: 'settings.memory',
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
        }
      ]
    },
    {
      titleKey: 'settings.groupSearch',
      specs: [
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
          kind: 'select',
          key: 'actionClickMode',
          labelKey: 'settings.actionClick',
          hintKey: 'settings.actionClickHint',
          options: [
            { value: 'panel', label: t('settings.actionClickPanel') },
            { value: 'regroup', label: t('settings.actionClickRegroup') }
          ]
        },
        {
          kind: 'toggle',
          key: 'uniqueUrlTabs',
          labelKey: 'settings.uniqueUrlTabs',
          hintKey: 'settings.uniqueUrlTabsHint'
        },
        {
          kind: 'toggle',
          key: 'pinyinSearch',
          labelKey: 'settings.pinyinSearch',
          hintKey: 'settings.pinyinSearchHint'
        },
        {
          kind: 'toggle',
          key: 'rowActionsVisible',
          labelKey: 'settings.rowActionsVisible',
          hintKey: 'settings.rowActionsVisibleHint'
        }
      ]
    },
    {
      // 低频分区：通知开关、角标模式、容量与开发者项集中在此。
      // 不再折叠（曾用 details 抽屉）：侧栏目录已提供直达导航，折叠只会隐藏内容。
      titleKey: 'settings.advanced',
      specs: [
        {
          kind: 'toggle',
          key: 'discardNotifyEnabled',
          labelKey: 'settings.discardNotify',
          hintKey: 'settings.discardNotifyHint'
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
          key: 'reuseNotifyEnabled',
          labelKey: 'settings.reuseNotify',
          hintKey: 'settings.reuseNotifyHint'
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
          key: 'autoSnapshotIntervalMin',
          labelKey: 'settings.autoSnapshotIntervalMin',
          hintKey: 'settings.autoSnapshotIntervalMinHint',
          visible: (s) => s.autoSaveSnapshots,
          parse: (v) => Number(v),
          options: [
            { value: '5', label: t('settings.minutesUnit', { count: 5 }) },
            { value: '15', label: t('settings.minutesUnit', { count: 15 }) },
            { value: '30', label: t('settings.minutesUnit', { count: 30 }) },
            { value: '60', label: t('settings.minutesUnit', { count: 60 }) },
            { value: '180', label: t('settings.minutesUnit', { count: 180 }) },
            { value: '720', label: t('settings.hoursUnit', { count: 12 }) }
          ]
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
        },
        {
          // snapshotLimit 早已在 trimSnapshots 中真实生效（总快照数上限，含命名/归档/轻量空间），
          // 但此前无任何 UI 入口，用户只能接受默认 30 —— 与相邻的 maxAutoSnapshots 不一致。
          // 不设 visible：它约束的是「全部快照」，与 autoSaveSnapshots 开关无关。
          kind: 'select',
          key: 'snapshotLimit',
          labelKey: 'settings.snapshotLimit',
          hintKey: 'settings.snapshotLimitHint',
          parse: (v) => Number(v),
          options: [
            { value: '10', label: '10' },
            { value: '20', label: '20' },
            { value: '30', label: '30' },
            { value: '50', label: '50' },
            { value: '100', label: '100' }
          ]
        }
      ]
    }
  ];
}
