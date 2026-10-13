import { useState } from 'react';
import type { ReactNode } from 'react';
import i18n, { useTranslation } from '@/i18n';
import type { Settings } from '@/core/schema/models';
import { COLOR_THEMES, type ColorTheme } from '@/core/theme/colorThemes';
import type { MirrorSyncIssue } from '@/platform/storage/SyncMirror';
import { useDataStore } from '@/stores/dataStore';
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
  | 'searchHistory'
  | 'showOtherWindows'
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
            title={t('确认操作')}
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

  // 整行的存废交由 render 结果决定：custom 行里有一类「状态行」（如同步状态），
  // 在**没有依据**时必须返回 null（不把猜测当事实），此时若仍渲染 Row，就会留下
  // 「同步状态」标题 + 空白值的常驻哑行——默认关闭同步时每个用户都看得到。
  // 判 null 而非判空：ReactNode 允许 0 / '' 等合法空渲染，只有 null 表示「不渲染」。
  const rendered = spec.render({ settings, update, t });
  if (rendered === null) return null;

  return (
    <Row label={label} hint={spec.hintKey ? t(spec.hintKey) : undefined}>
      {rendered}
    </Row>
  );
}

/**
 * 色号 → 展示文案（中文原文，取值会原样传进 `t()`）。
 * 色值取自 `@/core/theme/colorThemes` 的唯一来源，此处只补 UI 文案。
 * 用 `Record<ColorTheme, { labelKey: string }>` 约束，新增色号时漏配文案会直接编译报错。
 *
 * 属性名以 `Key` 结尾是扫描器的抽取约定（常量表不是调用点，只有 `*Key` 属性会被
 * 抽进词典）。此前靠 `@i18n-ignore-start/end` 豁免 zh-linter——只压住告警，
 * 词条始终没进词典，英文模式下色号名露中文而 scan / check 双绿。
 */
const COLOR_THEME_LABELS: Record<ColorTheme, { labelKey: string }> = {
  forest: { labelKey: '石墨绿' },
  ocean: { labelKey: '雾霾蓝' },
  violet: { labelKey: '暮山紫' },
  sunset: { labelKey: '暖阳橙' },
  mono: { labelKey: '中性灰' },
  plain: { labelKey: '纯净（默认）' }
};

/**
 * 同步镜像状态（BR-09）。
 *
 * 镜像拉取失败此前只进诊断日志，呈现为「用户以为开着同步，换机后什么都没有」。
 * 这里把「镜像不可用」做成一行只读状态：仅在开关开启时出现 —— 关着同步的用户
 * 看到一句关于镜像的警告只会困惑（对他们而言镜像本就不存在）。
 */
/**
 * 同步状态的取值：镜像**拉取**结果（`MirrorSyncIssue`）与「本次**写入**失败」。
 *
 * 写失败不是拉取结果的一种（二者可任意组合：写失败时云端仍留着上一次的旧镜像，
 * pull 照样成功），但它与拉取结果互斥地决定呈现哪一句，故在此合成单一状态枚举。
 */
type MirrorSyncState = MirrorSyncIssue | 'write-failed';

/**
 * 导出供行为规格测试直接渲染：五态映射必须逐态可断言
 * （见 tests/ui/mirror-sync-status.test.tsx）。
 */
export function MirrorSyncStatus({ t }: { t: (key: string) => string }) {
  const enabled = useDataStore((s) => s.settings.syncMirrorEnabled);
  const issue = useDataStore((s) => s.mirrorIssue);
  const writeFailed = useDataStore((s) => s.mirrorWriteFailed);

  // 本次会话没拉取过镜像（已 seeded 的设备不拉取，因为本地即权威）时通常不渲染：
  // 没有依据却显示「已生效」是把猜测当事实。写失败是例外——它是本次会话的真实
  // 结果，必须呈现，否则「开了同步但其他设备收不到」仍是静默的。
  if (!enabled) return null;
  const state: MirrorSyncState | null = writeFailed ? 'write-failed' : issue;
  if (state === null) return null;
  // 五态必须给五句不同的话：布尔只能表达「坏/不坏」，于是「镜像损坏」会被说成
  // 「超出容量上限」，而「从未同步过」反而显示「已生效」。
  // 用 Record 而非三元链：三元链的最后一态是「其他」兜底，将来 MirrorSyncIssue
  // 新增取值会静默归到「镜像损坏或已过期」这一句；Record 的键集由类型约束，
  // 漏配即编译报错（而不是静默落到错误文案）。
  const texts: Record<MirrorSyncState, string> = {
    'write-failed': t('未生效（本次改动未上传）：其他设备不会收到这份数据'),
    ok: t('已生效'),
    none: t('尚未生成镜像（本机数据将成为首份镜像）'),
    // 本机已有数据、本轮没有从镜像恢复任何东西：镜像存在，但这次启动没有验证过它。
    local: t('本机数据为准（本次未从镜像恢复）'),
    'chunk-limit': t('未生效（超出同步容量上限）：其他设备不会收到这份数据'),
    unreadable: t('未生效（镜像损坏或已过期）：其他设备不会收到这份数据')
  };
  const text = texts[state];
  // 只有「真的不生效」才标红：'none' 与 'local' 都是中性说明，不是故障。
  const failed = state === 'write-failed' || state === 'chunk-limit' || state === 'unreadable';
  return (
    // 长句说明走 11px（text-3xs）：10px 仅用于图标内文与徽角（见 main.css 字号刻度）
    <span className={failed ? 'text-3xs text-red-600' : 'text-3xs text-gray-500'}>{text}</span>
  );
}

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
): { id: string; titleKey: string; specs: SettingSpec[] }[] {
  return [
    {
      // id 是稳定的 DOM 锚点，必须与文案解耦：文案改用中文原文后，若继续拿
      // titleKey 当 id，锚点会随文案/语言变化而失效（如 #settings.advanced
      // 变成 #高级与恢复，分享链接与目录跳转全部断掉）。
      id: 'settings.appearance',
      titleKey: '外观与布局',
      specs: [
        {
          kind: 'select',
          key: 'themePreference',
          labelKey: '主题',
          options: [
            { value: 'system', label: t('跟随系统') },
            { value: 'light', label: t('浅色') },
            { value: 'dark', label: t('深色') }
          ]
        },
        {
          kind: 'custom',
          labelKey: '主题色',
          hintKey: '强调色与深色底色随所选色号变化',
          render: ({ settings, update, t }) => (
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t('主题色')}>
              {COLOR_THEMES.map((swatch) => (
                <input
                  key={swatch.id}
                  type="radio"
                  name="colorTheme"
                  checked={settings.colorTheme === swatch.id}
                  title={t(COLOR_THEME_LABELS[swatch.id].labelKey)}
                  aria-label={t(COLOR_THEME_LABELS[swatch.id].labelKey)}
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
          labelKey: '显示常驻磁贴',
          hintKey: '显示侧边栏顶部的常驻磁贴条与浏览器固定标签区'
        },
        {
          kind: 'custom',
          labelKey: '侧边栏位置',
          hintKey: '位置由 Chrome 控制；请在 Chrome 的侧边栏设置中选择左侧或右侧，Tabs 会自动跟随',
          render: () => (
            <span className="rounded border border-gray-200 bg-surface px-2 py-1 text-xs text-gray-600">
              {sidePanelSide === 'left'
                ? t('左侧')
                : sidePanelSide === 'right'
                  ? t('右侧')
                  : t('由浏览器控制')}
            </span>
          )
        },
        {
          kind: 'select',
          key: 'density',
          labelKey: '列表密度',
          options: [
            { value: 'compact', label: t('紧凑') },
            { value: 'cozy', label: t('宽松') },
            { value: 'large', label: t('大字号') }
          ]
        },
        {
          kind: 'toggle',
          key: 'showUrl',
          labelKey: '显示网址',
          hintKey: '在标签标题下方显示完整网址'
        },
        {
          kind: 'toggle',
          key: 'footerLabels',
          labelKey: '底栏显示文字标签',
          hintKey:
            '开启后图标旁显示功能名称，便于快速识别（面板过窄时自动退回纯图标，避免底栏换行）'
        },
        {
          kind: 'toggle',
          key: 'showSplitBadges',
          labelKey: '显示分屏标记',
          hintKey: '为处于浏览器分屏的标签显示「拆 / 伴」标记'
        },
        {
          kind: 'select',
          key: 'groupAccentStyle',
          labelKey: '分组配色',
          hintKey: '站点组强调色：按站点自动配色，或统一中性色',
          options: [
            { value: 'auto', label: t('自动配色') },
            { value: 'mono', label: t('统一中性') }
          ]
        }
      ]
    },
    {
      id: 'settings.behavior',
      titleKey: '交互行为',
      specs: [
        {
          kind: 'custom',
          labelKey: '语言',
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
                // 语言名用该语言自己的写法（autonym），与当前界面语言无关——
                // 这样中文用户看到「简体中文」、英文用户看到「English」，切换前后
                // 都能认出自己的语言。此前是写死字面量，绕过了 t()。
                { value: 'zh-CN', label: t('简体中文') },
                // 'English' 不含汉字，落「语义 key 直通」分支，不进词典也不需要译文：
                // 语言名本就该以该语言自身写法呈现。
                { value: 'en', label: t('English') }
              ]}
              ariaLabel={t('语言')}
            />
          )
        },
        {
          kind: 'select',
          key: 'newTabPosition',
          labelKey: '新建标签位置',
          hintKey:
            '无论用哪种方式新建标签（Ctrl+T、浏览器 + 按钮、侧边栏按钮），都出现在窗口末尾，或当前激活标签之后',
          options: [
            { value: 'end', label: t('窗口末尾') },
            { value: 'after-active', label: t('激活标签之后') }
          ]
        },
        {
          kind: 'toggle',
          key: 'autoScrollActive',
          labelKey: '激活标签自动滚入视野',
          hintKey: '切换标签时把当前标签滚动到可见区域'
        },
        {
          kind: 'toggle',
          key: 'closeOnMiddleClick',
          labelKey: '中键点击关闭标签',
          hintKey: '在标签行上按鼠标中键关闭该标签'
        },
        {
          kind: 'toggle',
          key: 'showOtherWindows',
          labelKey: '显示其他窗口',
          hintKey: '侧边栏底部按窗口分段展示其他窗口的标签（只读浏览，可聚焦或关闭）'
        },
        {
          kind: 'select',
          key: 'sortMode',
          labelKey: '排序方式',
          hintKey: '「最近访问」在新页面打开时一次性就位（新页面靠前），切换标签不再重排列表',
          options: [
            { value: 'browser', label: t('浏览器顺序') },
            { value: 'recency', label: t('最近访问') }
          ]
        },
        {
          kind: 'toggle',
          key: 'tabOrderSync',
          labelKey: '标签顺序双向同步',
          hintKey:
            '开启后可在侧边栏拖拽标签重排，并实时同步到浏览器原生标签顺序（原生侧改动也会反向同步）'
        },
        {
          kind: 'select',
          key: 'aggregationThreshold',
          labelKey: '站点聚合阈值（同一站点几个标签自动成组）',
          hintKey:
            '同一站点（含子域）的标签达到该数量自动成组；设为 1 时只要有标签就成组（单标签站点也成组）',
          parse: (v) => Number(v),
          options: [
            { value: '1', label: t('1（只要有标签就分组）') },
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
      id: 'settings.memory',
      titleKey: '休眠与内存',
      specs: [
        {
          kind: 'toggle',
          key: 'autoDiscardEnabled',
          labelKey: '自动休眠后台标签',
          hintKey: '超过设定时间未访问的标签自动休眠，释放内存；自动休眠可撤销'
        },
        {
          kind: 'custom',
          labelKey: '休眠等待时长（5–240 分钟）',
          visible: (s) => s.autoDiscardEnabled,
          render: ({ settings, update, t }) => (
            <TextField
              type="number"
              size="sm"
              className="w-20"
              min={5}
              max={240}
              value={String(settings.autoDiscardMinutes)}
              ariaLabel={t('休眠等待时长（5–240 分钟）')}
              onChange={(next) =>
                update('autoDiscardMinutes', Math.min(240, Math.max(5, Number(next) || 30)))
              }
            />
          )
        },
        {
          kind: 'custom',
          labelKey: '休眠白名单',
          hintKey:
            '这些域名永不参与自动休眠（如 mail.example.com 或 example.com）；固定空间里的条目与被固定的标签（含常驻磁贴）默认豁免',
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
      id: 'settings.groupSearch',
      titleKey: '分组与搜索',
      specs: [
        {
          kind: 'toggle',
          key: 'searchAllWindows',
          labelKey: '搜索扩展到所有窗口',
          hintKey: '开启后，搜索会覆盖其他窗口的标签并可一键切换过去（默认仅当前窗口）'
        },
        {
          kind: 'toggle',
          key: 'searchHistory',
          labelKey: '搜索包含历史（快照与归档）',
          hintKey:
            '开启后，搜索同时命中快照与归档里的条目，可单独打开某个页面或恢复整份快照（索引最近 20 份，搜索框内有开关可临时切换）'
        },
        {
          kind: 'select',
          key: 'groupMode',
          labelKey: '未固定标签的聚合方式',
          options: [
            { value: 'site', label: t('按域名') },
            { value: 'opener', label: t('按来源树') },
            { value: 'language', label: t('按语言') }
          ]
        },
        {
          kind: 'toggle',
          key: 'autoGroupNative',
          labelKey: '自动创建原生标签组',
          hintKey:
            '开启后，按域名或语言聚合的标签会自动组成浏览器原生标签组（来源树模式除外）；关闭开关时会解散由本功能创建的组',
          confirmOffKey: '关闭后会解散由 Tabs 创建的原生标签组，但不会关闭标签。确定继续吗？'
        },
        {
          kind: 'select',
          key: 'actionClickMode',
          labelKey: '点击工具栏图标',
          hintKey:
            '「打开侧边栏」即默认行为；「后台整理标签」点击时直接按域名整理临时区、不弹出面板（面板仍可从侧边栏入口或 Ctrl+Shift+O 打开）',
          options: [
            { value: 'panel', label: t('打开侧边栏') },
            { value: 'regroup', label: t('后台整理标签（不打开侧边栏）') }
          ]
        },
        {
          kind: 'toggle',
          key: 'uniqueUrlTabs',
          labelKey: '同一网址只保留一个标签',
          hintKey:
            '打开一个已存在的网址时，自动切到已有标签并关掉重复副本。关闭此开关则允许同一网址多开'
        },
        {
          kind: 'toggle',
          key: 'pinyinSearch',
          labelKey: '搜索支持拼音',
          hintKey: '用拼音首字母或全拼匹配中文标签标题（如 "tb" 或 "taobao" 均可命中 "淘宝"）'
        },
        {
          kind: 'toggle',
          key: 'rowActionsVisible',
          labelKey: '行操作按钮常显',
          hintKey: '关闭后，行内操作（静音/固定/复制等）仅在悬停或聚焦时显示'
        }
      ]
    },
    {
      // 低频分区：通知开关、角标模式、容量与开发者项集中在此。
      // 不再折叠（曾用 details 抽屉）：侧栏目录已提供直达导航，折叠只会隐藏内容。
      id: 'settings.advanced',
      titleKey: '高级与恢复',
      specs: [
        {
          kind: 'toggle',
          key: 'discardNotifyEnabled',
          labelKey: '自动休眠系统通知',
          hintKey: '自动休眠完成时弹出系统通知（侧边栏内始终可撤销）'
        },
        {
          kind: 'select',
          key: 'badgeMode',
          labelKey: '工具栏角标',
          hintKey: '角标显示内容：有重复时警示重复数，否则显示标签数',
          options: [
            { value: 'auto', label: t('自动（重复优先）') },
            { value: 'count', label: t('标签数') },
            { value: 'dups', label: t('重复组数') },
            { value: 'off', label: t('关闭') }
          ]
        },
        {
          kind: 'toggle',
          key: 'reuseNotifyEnabled',
          labelKey: '重复标签合并提示',
          hintKey: '同网址标签被自动合并时显示提示'
        },
        {
          kind: 'toggle',
          key: 'contextMenusEnabled',
          labelKey: '右键菜单',
          hintKey: '页面 / 链接 / 标签栏 / 工具栏图标右键快捷操作'
        },
        {
          kind: 'toggle',
          key: 'omniboxEnabled',
          labelKey: '地址栏命令',
          hintKey: '输入 t 加关键词，直达标签与固定空间条目'
        },
        {
          /**
           * 跨设备镜像开关（R6 / IA-2）。
           *
           * 此前它是 SettingsPage 里**手写**的 Toggle，不在 buildSections 的规格数组内，
           * 于是设置页搜索（只匹配 spec.labelKey / spec.hintKey）**搜不到它**——
           * 一个会影响「数据是否被上传到浏览器账号通道」的开关，却无法被搜索到。
           * 改为 custom 行后进入搜索索引，同时保留原有渲染与语义不变。
           */
          kind: 'custom',
          labelKey: '跨设备同步',
          hintKey:
            '默认关闭。开启后，文件夹、常驻磁贴与设置会镜像到你浏览器账号的同步通道（Tabs 没有自己的服务器）；关闭时会一并删除已上传的数据',
          render: ({ settings, update, t }) => (
            <Toggle
              checked={settings.syncMirrorEnabled}
              onChange={(checked) => update('syncMirrorEnabled', checked)}
              ariaLabel={t('跨设备同步')}
            />
          )
        },
        {
          // 与上一行成对：开关给出「要不要同步」，本行给出「同步到底生效了没有」。
          kind: 'custom',
          labelKey: '同步状态',
          hintKey: '跨设备同步是否生效',
          render: ({ t }) => <MirrorSyncStatus t={t} />
        },
        {
          kind: 'custom',
          labelKey: '开发者：指定站点禁用缓存',
          hintKey:
            '命中站点不使用浏览器缓存（含子资源，效果等同开发者工具里的「禁用缓存」）；命中的标签在侧边栏显示「禁」角标；开启需授权网站访问权限',
          render: ({ settings, update }) => <NoCacheToggle settings={settings} update={update} />
        },
        {
          kind: 'custom',
          labelKey: '禁缓存站点列表',
          hintKey: '支持域名 / 域名+路径 / 完整 URL 前缀三种格式，例：example.com',
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
          labelKey: '可撤销的关闭次数',
          hintKey: '最多可连续撤销的关闭操作次数（超出后最早的记录被淘汰）',
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
          labelKey: '提示条时长',
          hintKey: '状态提示（如「已关闭 N 个标签」）自动消失前的显示时长',
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
          labelKey: '撤销记录跨重启保留',
          hintKey: '关闭后，撤销记录仅存在于当前会话，浏览器重启后不可撤销'
        },
        {
          kind: 'toggle',
          key: 'autoSaveSnapshots',
          labelKey: '自动保存快照',
          hintKey:
            '开启后：①按下方间隔定时保存快照；②窗口关闭时自动保存快照。依赖浏览器后台机制，不保证任意时刻都有一份最新快照；重要现场请手动保存'
        },
        {
          kind: 'select',
          key: 'autoSnapshotIntervalMin',
          labelKey: '定时快照间隔',
          hintKey: '每隔这么久自动保存一次当前窗口快照；标签内容无变化时不重复写入',
          visible: (s) => s.autoSaveSnapshots,
          parse: (v) => Number(v),
          options: [
            { value: '5', label: t('{{count}} 分钟', { count: 5 }) },
            { value: '15', label: t('{{count}} 分钟', { count: 15 }) },
            { value: '30', label: t('{{count}} 分钟', { count: 30 }) },
            { value: '60', label: t('{{count}} 分钟', { count: 60 }) },
            { value: '180', label: t('{{count}} 分钟', { count: 180 }) },
            { value: '720', label: t('{{count}} 小时', { count: 12 }) }
          ]
        },
        {
          kind: 'select',
          key: 'maxAutoSnapshots',
          labelKey: '自动快照保留数',
          hintKey: '仅保留最新的 N 条自动快照（含定时与关窗两种），超出自动淘汰最旧记录',
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
          // snapshotLimit 早已在 trimSnapshots 中真实生效（命名快照 / 归档 / 工作区的保留上限，
          // 关窗自动保存由 maxAutoSnapshots 独立收敛），
          // 但此前无任何 UI 入口，用户只能接受默认 30 —— 与相邻的 maxAutoSnapshots 不一致。
          // 不设 visible：它约束的是「非自动快照」，与 autoSaveSnapshots 开关无关。
          kind: 'select',
          key: 'snapshotLimit',
          labelKey: '手动快照保留上限',
          hintKey:
            '命名快照、归档与工作区的保留上限，超出自动淘汰最旧记录（关窗自动保存另有单独上限）',
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
