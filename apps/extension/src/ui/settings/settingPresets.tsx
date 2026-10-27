import { useState } from 'react';
import { useTranslation } from '@/i18n';
import { openSidePanel } from '@/platform/sidePanel';
import { useDataStore } from '@/stores/dataStore';
import type { Settings } from '@/core/schema/models';
import { Button } from '@/ui/common/Button';
import { Chip } from '@/ui/common/Chip';
import { Icon, Icons } from '@/ui/common/Icon';
import { Section } from '@/ui/settings/settingControls';

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
    nameKey: '研究者',
    descKey: '按项目收纳：站点聚合 + 最近访问排序 + 拼音搜索',
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
    nameKey: '内存节俭者',
    descKey: '自动休眠闲置标签释放内存，固定条目默认豁免',
    patch: { autoDiscardEnabled: true, autoDiscardMinutes: 30, discardNotifyEnabled: true }
  },
  {
    id: 'efficiency',
    nameKey: '效率玩家',
    descKey: '键盘优先：行操作常显、中键关闭、拼音搜索',
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
  /** 最近一次套用的预设及其生效前的设置快照：提供「撤销预设」出口。 */
  const [undoPatch, setUndoPatch] = useState<{
    patch: Partial<Settings>;
    before: Partial<Settings>;
  } | null>(null);
  /**
   * 激活态 = 当前设置与预设 patch 逐字段完全一致（不记「最近点过谁」——
   * 预设是配置模板，套用后用户逐项微调即漂移，按值比对才诚实）。
   */
  const isActive = (preset: PresetProfile): boolean =>
    Object.entries(preset.patch).every(([key, value]) => settings[key as keyof Settings] === value);

  const applyPreset = async (preset: PresetProfile) => {
    if (isActive(preset)) return;
    // 应用前快照被覆盖字段的旧值，供撤销恢复（一键套用改 5 项设置，
    // 没有出口的话用户只能逐项手动改回，等于惩罚探索）。
    const before: Partial<Settings> = {};
    for (const key of Object.keys(preset.patch) as (keyof Settings)[]) {
      // 逐字段赋值：Settings 各字段类型互异，直接索引赋值无法通过编译期检查。
      (before as Record<keyof Settings, unknown>)[key] = settings[key];
    }
    const ok = await tryUpdateSettings(preset.patch);
    if (ok) {
      setUndoPatch({ patch: preset.patch, before });
      onApplied(t('已应用「{{name}}」预设', { name: t(preset.nameKey) }));
    } else {
      onApplied(t('设置未保存：存储不可用，请重试'));
    }
  };

  const revertPreset = async () => {
    if (!undoPatch) return;
    const { before } = undoPatch;
    setUndoPatch(null);
    const ok = await tryUpdateSettings(before);
    onApplied(ok ? t('已撤销预设更改') : t('设置未保存：存储不可用，请重试'));
  };

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-surface p-4 sm:mb-8">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">{t('快速预设')}</h2>
        {/* 与 SnapshotRow 的「恢复勾选」同款强调色文字按钮，统一走 accent-ghost。 */}
        {undoPatch && (
          <Button variant="accent-ghost" size="xs" onClick={() => void revertPreset()}>
            {t('撤销预设')}
          </Button>
        )}
      </div>
      {/* 11px：与同文件预设描述（text-3xs）同档，小一号会显得不统一 */}
      <p className="mb-3 text-3xs text-gray-600">{t('一键套用适合你的配置，之后仍可逐项微调')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PRESET_PROFILES.map((preset) => {
          const active = isActive(preset);
          // 刻意保留裸 button：预设卡是 toggle 语义（aria-pressed），而 Button /
          // IconButton / RowActionButton 都不下发 aria-pressed；换成 Button 会让
          // 读屏丢失「使用中」状态，且卡片是 flex-col 多行布局，不是按钮形态。
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
              onClick={() => void applyPreset(preset)}
            >
              <span className="flex w-full items-center justify-between gap-1">
                <span className="text-sm font-medium text-gray-800">{t(preset.nameKey)}</span>
                {active && (
                  /* 两处「使用中」徽章必须同构：此前只有「自定义」那一处被收口，
                     激活预设的这一处仍手写同一套 class 串。 */
                  <Chip
                    tone="accent"
                    cjk
                    size="md"
                    className="inline-flex shrink-0 items-center gap-0.5"
                  >
                    <Icon d={Icons.check} className="h-3 w-3" />
                    {t('使用中')}
                  </Chip>
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
              <span className="text-sm font-medium text-gray-700">{t('自定义')}</span>
              <Chip cjk size="md" className="inline-flex shrink-0 items-center gap-0.5">
                <Icon d={Icons.check} className="h-3 w-3" />
                {t('使用中')}
              </Chip>
            </span>
            <span className="text-3xs leading-snug text-gray-600">
              {t('当前配置由你手动调整，不对应任何预设；可点击上方预设一键套用')}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

/** 能力发现清单：用图标 + 一句话 +「试用」把藏得深的能力推到用户面前。 */
const CAPABILITIES = [
  {
    icon: Icons.menu,
    titleKey: '右键菜单',
    howKey: '在页面、链接或标签栏右键，快速休眠 / 固定 / 按域名搜索'
  },
  {
    icon: Icons.search,
    titleKey: '地址栏 t 命令',
    howKey: '地址栏输入 t + 关键词，直达标签与收藏夹条目'
  },
  {
    icon: Icons.shortcuts,
    titleKey: '命令面板（⌘P）',
    howKey: '搜索并直接执行动作：休眠全部、存快照、开设置'
  },
  {
    icon: Icons.pin,
    titleKey: '收藏夹',
    howKey: '把常用页面拖到顶部常驻磁贴，或拖入收藏夹的文件夹，随时一键直达'
  },
  {
    icon: Icons.snapshot,
    titleKey: '快照',
    howKey: '关窗自动保存，也可手动把当前窗口存为快照随时恢复'
  },
  { icon: Icons.history, titleKey: '撤销安全网', howKey: '所有关闭操作都可撤销，误关也不怕' }
] as const;

export function CapabilitiesGuide() {
  const { t } = useTranslation();
  const tryUpdateSettings = useDataStore((state) => state.tryUpdateSettings);
  /** 重播引导：重置 onboarded 标记（tipSeen/conceptsSeen 不动）并打开侧边栏立即观看。
   *  Esc 误关引导的用户需要有回看入口，否则只能错过首启教学。 */
  const replayTour = async () => {
    await tryUpdateSettings({ onboarded: false });
    void openSidePanel();
  };
  return (
    <Section title={t('你能做什么')}>
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
            <Button variant="secondary" size="sm" onClick={() => void openSidePanel()}>
              {t('在侧边栏试用')}
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600">
            <Icon d={Icons.sparkles} className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-800">{t('重新观看引导')}</p>
            <p className="mt-0.5 text-3xs leading-snug text-gray-600">
              {t('下次打开侧边栏时重新播放首启引导（误按 Esc 关闭后可从这里找回）')}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void replayTour()}>
            {t('重新观看')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
