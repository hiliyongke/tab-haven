import { useTranslation } from 'react-i18next';
import { openSidePanelInCurrentWindow } from '@/platform/sidePanel';
import { useDataStore } from '@/stores/dataStore';
import type { Settings } from '@/core/schema/models';
import { Button } from '@/ui/common/Button';
import { Icon, Icons } from '@/ui/common/Icon';
import { Section } from '@/entrypoints/options/settingControls';

/**
 * 设置页的「引导层」：预设画像与能力发现。
 *
 * 与配置层（`settingSections.tsx`）分层的原因：两者都是设置页的独立板块，
 * 但互相不依赖 —— 拆开后 SettingsPage 的主组件只剩编排逻辑。
 */

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

export function PresetsPanel({ onApplied }: { onApplied: (message: string) => void }) {
  const { t } = useTranslation();
  const settings = useDataStore((state) => state.settings);
  const tryUpdateSettings = useDataStore((state) => state.tryUpdateSettings);
  /**
   * 激活态 = 当前设置与预设 patch 逐字段完全一致（不记「最近点过谁」——
   * 预设是配置模板，套用后用户逐项微调即漂移，按值比对才诚实）。
   */
  const isActive = (preset: PresetProfile): boolean =>
    Object.entries(preset.patch).every(([key, value]) => settings[key as keyof Settings] === value);
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-surface p-4 sm:mb-8">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">{t('presets.title')}</h2>
      <p className="mb-3 text-2xs text-gray-600">{t('presets.hint')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PRESET_PROFILES.map((preset) => {
          const active = isActive(preset);
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              className={
                'relative flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-base ' +
                (active
                  ? 'border-accent-500 bg-accent-50'
                  : 'border-control bg-surface hover:border-accent-400 hover:bg-accent-50')
              }
              onClick={async () => {
                // 已在使用中的预设重复点击无副作用，直接忽略。
                if (active) return;
                // 按结果反馈，不抢先报成功（写入失败时 store 不会变更）。
                const ok = await tryUpdateSettings(preset.patch);
                onApplied(
                  ok ? t('presets.applied', { name: t(preset.nameKey) }) : t('settings.saveFailed')
                );
              }}
            >
              <span className="flex w-full items-center justify-between gap-1">
                <span className="text-sm font-medium text-gray-800">{t(preset.nameKey)}</span>
                {active && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent-100 px-1.5 py-px text-3xs font-medium text-accent-700">
                    <Icon d={Icons.check} className="h-3 w-3" />
                    {t('presets.active')}
                  </span>
                )}
              </span>
              <span className="text-3xs leading-snug text-gray-600">{t(preset.descKey)}</span>
            </button>
          );
        })}
        {/* 三个预设均未命中（用户手动调整过）→ 显示「自定义」状态卡：非选项，仅状态呈现 */}
        {!PRESET_PROFILES.some((preset) => isActive(preset)) && (
          <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-gray-300 bg-surface px-3 py-2 sm:col-span-3">
            <span className="flex w-full items-center justify-between gap-1">
              <span className="text-sm font-medium text-gray-700">{t('presets.custom')}</span>
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-px text-3xs font-medium text-gray-600">
                <Icon d={Icons.check} className="h-3 w-3" />
                {t('presets.active')}
              </span>
            </span>
            <span className="text-3xs leading-snug text-gray-600">{t('presets.customDesc')}</span>
          </div>
        )}
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

export function CapabilitiesGuide() {
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
              <p className="mt-0.5 text-3xs leading-snug text-gray-600">{t(cap.howKey)}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void openSidePanelInCurrentWindow()}
            >
              {t('settings.capTry')}
            </Button>
          </div>
        ))}
      </div>
    </Section>
  );
}
