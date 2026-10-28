import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useDataStore } from '@/stores/dataStore';
import { useUndoStore } from '@/stores/undoStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import type { Settings } from '@/core/schema/models';
import { Button } from '@/ui/common/Button';
import { Callout } from '@/ui/common/Callout';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { FixedConceptsMap } from '@/ui/common/FixedConceptsMap';
import { TextField } from '@/ui/common/TextField';
import {
  clearDiagnostics,
  exportDiagnostics,
  logDegraded,
  readAllDiagnostics
} from '@/platform/diagnostics';
import { clearQuarantine, readQuarantine } from '@/platform/storage/DataRepository';
import { getSidePanelSide, type SidePanelSide } from '@/platform/sidePanel';
import { downloadJsonFile, openAboutPage, openUrlInTab } from '@/platform/navigation';
import { datedJsonFilename } from '@/core/util/filename';
import { SettingsOutline, type OutlineItem } from '@/ui/settings/SettingsOutline';
import { Row, Section } from '@/ui/settings/settingControls';
import { buildSections, SettingRow, type SettingSpec } from '@/entrypoints/options/settingSections';
import { CapabilitiesGuide, PresetsPanel } from '@/ui/settings/settingPresets';
import { ShortcutsSection } from '@/ui/settings/ShortcutsSection';
import { ClearDataDialog } from '@/entrypoints/options/ClearDataDialog';

/**
 * 设置页**编排层**：状态、写盘通道与弹窗流转。
 *
 * 已按职责拆分（自上而下单向依赖）：
 *  - `settingControls.tsx` —— 展示层控件（分区 / 行容器 / 编辑器），叶子；
 *  - `settingSections.tsx` —— 声明式配置（buildSections + SettingRow）；
 *  - `settingPresets.tsx` —— 引导层（预设画像 / 能力发现）；
 *  - 本文件 —— 只做状态编排与 JSX 组装，不再承载任何配置体。
 */

/** 导入文件体积上限（5MB）：备份为纯 JSON，此上限已远超正常使用规模。 */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * 导入事务的分区名 → 界面称呼（写盘失败提示要指出卡在哪一步）。
 *
 * 值存的是**待翻译的原文**，由 `partitionLabel` 在提示那一刻经 `t()` 翻译 ——
 * 此处直接写 `t(...)` 会让映射在模块加载期求值，那时语言尚未确定，切语言后文案
 * 不会跟着变。
 *
 * 形态与 `settingSections.tsx` 的 `COLOR_THEME_LABELS` 一致（属性名以 `Key` 结尾）：
 * 这是扫描器抽取常量表的约定（常量表不是调用点，只有 `*Key` 属性的值会被抽进词典）。
 * 早先这里是 `Record<string, string>` 且整块 `@i18n-ignore` 豁免 —— 豁免压住的只是
 * zh-linter 告警，词条进不了词典，英文模式下「折叠状态」直接露中文而 scan / check 双绿。
 */
const PARTITION_LABELS: Record<string, { labelKey: string }> = {
  folders: { labelKey: '收藏夹' },
  pins: { labelKey: '常驻磁贴' },
  settings: { labelKey: '设置' },
  snapshots: { labelKey: '快照' },
  siteCollapse: { labelKey: '折叠状态' }
};

/** 取分区的界面称呼；未知分区原样返回（不丢信息）。 */
function partitionLabel(name: string, t: (key: string) => string): string {
  const label = PARTITION_LABELS[name];
  return label === undefined ? name : t(label.labelKey);
}

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useDataStore((state) => state.settings);
  /** 导入事务进行中：期间禁用导入入口（并发导入会被拒绝，不如直接不让点）。 */
  const importing = useDataStore((state) => state.importing);
  const ready = useDataStore((state) => state.ready);
  const tryUpdateSettings = useDataStore((state) => state.tryUpdateSettings);
  const resetSettings = useDataStore((state) => state.resetSettings);
  const exportData = useDataStore((state) => state.exportData);
  const importData = useDataStore((state) => state.importData);
  const clearAllData = useDataStore((state) => state.clearAllData);
  const importBookmarksFromBar = useDataStore((state) => state.importBookmarksFromBar);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  /** 设置写入失败（页面级）：必须出现在改动发生的那一屏，不能落到页面底部。 */
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [sidePanelSide, setSidePanelSide] = useState<SidePanelSide>('unknown');
  /** 已解析待导入的备份数据（非 null 时显示导入确认弹窗）。 */
  const [pendingImport, setPendingImport] = useState<unknown>(null);
  /** 设置项搜索：匹配分区内 label/hint 文案。 */
  const [settingsSearch, setSettingsSearch] = useState('');
  /** 恢复默认设置的确认弹窗。 */
  const [confirmingReset, setConfirmingReset] = useState(false);
  /** 清除所有数据的确认弹窗 + 勾选确认（危险操作的防误触双保险）。 */
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearAck, setClearAck] = useState(false);
  /** 坏数据隔离区条数：让用户看得见「有没有数据被判坏过」（PRIVACY.md §3.1-a）。 */
  const [quarantineCount, setQuarantineCount] = useState(0);

  const refreshQuarantineCount = () => {
    void readQuarantine()
      .then((list) => setQuarantineCount(list.length))
      .catch(() => setQuarantineCount(0));
  };

  useEffect(() => {
    refreshQuarantineCount();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSidePanelSide()
      .then((side) => {
        if (!cancelled) setSidePanelSide(side);
      })
      .catch((error: unknown) => {
        // 探测失败会让本页无法提示「侧边栏在左/右」，用户按说明找不到位置。
        logDegraded('options', '侧边栏位置探测失败', error);
        if (!cancelled) setSidePanelSide('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 设置页的唯一写入通道。
   *
   * 失败必须在**视口内**说清楚：设置是跨会话行为契约，写盘失败时 store 不会变更，
   * 界面会静默弹回旧值——用户只会觉得「开关点不动」，而不会知道数据根本没保存。
   *
   * 状态单独存放（不复用 `transferStatus`）：后者只渲染在页面底部的「数据备份」
   * 分区里，而设置项散布在整页，把它顶到一屏之外等于没有提示。
   */
  const update = (key: keyof Settings, value: unknown) => {
    void tryUpdateSettings({ [key]: value } as Partial<Settings>).then((ok) => {
      setSettingsStatus(ok ? null : t('设置未保存：存储不可用，请重试'));
    });
  };

  const handleExport = async () => {
    try {
      const payload = JSON.stringify(await exportData(), null, 2);
      // 下载实现统一走 platform（与首启引导共用一份），入口层不自己拼 <a download>。
      downloadJsonFile(datedJsonFilename('tabs-backup'), payload);
      setTransferStatus(t('备份已导出'));
    } catch {
      // 快照读取或序列化失败：宁可明确报错，也不能给出一份内容不全的备份。
      setTransferStatus(t('导出失败：本地数据读取未完成'));
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // 体积上限：备份是纯 JSON，5MB 已远超正常使用规模；不设限会让超大文件
    // 在 file.text() 阶段直接卡死设置页。
    if (file.size > MAX_IMPORT_BYTES) {
      setTransferStatus(t('导入失败：备份文件超过 5MB，请拆分后再导入'));
      return;
    }
    try {
      // 先解析，确认弹窗由自制 ConfirmDialog 承接（与全站弹窗体系一致）。
      setPendingImport(JSON.parse(await file.text()) as unknown);
    } catch {
      setTransferStatus(t('导入失败：备份文件无效或无法读取'));
    }
  };

  const runImport = () => {
    if (pendingImport === null) return;
    void importData(pendingImport)
      .then(() => setTransferStatus(t('备份已导入')))
      .catch((error: unknown) => {
        // 版本不兼容要说得清下一步：笼统「导入失败」会让用户以为备份坏了。
        const raw = error instanceof Error ? error.message : '';
        const message =
          raw === 'export-version-mismatch'
            ? t(
                '备份文件版本与当前 Tabs 不兼容：它由另一个版本导出。请用导出该备份的 Tabs 版本导入，或在新版本里重新导出一份。'
              )
            : // 写盘失败带分区名（transferSlice 抛 `import-write-failed:<分区>`）。
              // 一律落到「文件无效」会掩盖真实原因（存储不可用），用户会反复
              // 重试导入、甚至以为备份损坏。分区名让人知道卡在哪一步。
              raw.startsWith('import-write-failed:')
              ? t(
                  '导入失败：写入「{{name}}」时存储不可用，已回滚（本地数据保持导入前的状态）。请确认浏览器存储空间后重试。',
                  { name: partitionLabel(raw.slice('import-write-failed:'.length), t) }
                )
              : t('导入失败：备份文件无效或无法读取');
        setTransferStatus(message);
      });
    setPendingImport(null);
  };

  const handleImportBookmarks = () => {
    void importBookmarksFromBar()
      .then((result) =>
        setTransferStatus(
          t('已导入 {{folders}} 个文件夹 / {{items}} 条', {
            folders: result.foldersCreated,
            items: result.itemsImported
          })
        )
      )
      .catch((error: unknown) => {
        logDegraded('options', '书签栏导入失败', error);
        setTransferStatus(t('导入失败：未能读取书签栏，请稍后重试'));
      });
  };

  /** 打开浏览器「扩展快捷键」设置页。 */
  const openShortcutSettings = () => {
    void openUrlInTab('chrome://extensions/shortcuts');
  };

  /**
   * 导出诊断信息。
   *
   * 无遥测产品看不见线上故障，用户报障时只能描述「点了没反应」。
   * 这份本地报告是唯一的排查凭据；内容刻意不含页面标题与网址，
   * 所以「导出诊断」这一用户主动行为依然不泄露浏览内容。
   */
  const handleExportDiagnostics = async () => {
    try {
      // 跨上下文全量读取：诊断环形缓冲落在 storage.local，
      // background SW / sidepanel 的降级记录都在其中（纯内存缓冲会漏掉主故障现场）。
      const entries = await readAllDiagnostics();
      // 坏数据隔离区一并导出：它不进诊断环形缓冲（会被真故障挤出），
      // 而「哪个存储键坏过、坏了什么」恰恰是排查坏数据类报障的关键凭据。
      // PRIVACY.md 第 3.1-a 节对外承诺了这条出口，只写不读会让承诺落空。
      const quarantine = await readQuarantine();
      if (entries.length === 0 && quarantine.length === 0) {
        setTransferStatus(t('暂无异常记录'));
        return;
      }
      downloadJsonFile(
        datedJsonFilename('tabs-diagnostics'),
        exportDiagnostics(entries, quarantine)
      );
      await clearDiagnostics();
      if (quarantine.length > 0) await clearQuarantine();
      refreshQuarantineCount();
      setTransferStatus(t('诊断信息已导出'));
    } catch (error) {
      logDegraded('options', '诊断信息导出失败', error);
      setTransferStatus(t('导出失败：本地数据读取未完成'));
    }
  };

  /** 恢复全部设置为默认值（带确认弹窗）。 */
  const handleResetSettings = () => {
    void resetSettings()
      .then(() => setTransferStatus(t('已恢复默认设置')))
      .catch((error: unknown) => {
        logDegraded('options', '恢复默认设置失败', error);
        setTransferStatus(t('恢复默认失败，请重试'));
      });
    setConfirmingReset(false);
  };

  /**
   * 清除所有数据：store 清仓库/会话/镜像。
   *
   * 跨 store 的内存态必须在这一层一并重置：dataStore 不持有撤销栈与快照列表，
   * 只清自己会让侧边栏继续显示已删除的快照、并允许撤销已被清除的批次。
   */
  const handleClearData = () => {
    void clearAllData()
      .then(() => {
        void useUndoStore.getState().clearBatches();
        useSnapshotStore.getState().reset();
        setTransferStatus(t('已清除全部数据'));
      })
      .catch((error: unknown) => {
        logDegraded('options', '清除全部数据失败', error);
        setTransferStatus(t('清除失败，请重试'));
      });
    setConfirmingClear(false);
    setClearAck(false);
  };

  // 分组配置见 settingSections.ts 的 buildSections。此处再 memo 一层：配置约 370 行且含大量
  // t() 调用，若每次渲染重建，每敲一个搜索字符都会全量重算翻译与 render 闭包。
  // 必须在下面的 early return 之前调用（Hooks 规则：调用顺序须每次渲染一致）。
  const sections = useMemo(() => buildSections(t, sidePanelSide), [t, sidePanelSide]);

  const isSearching = settingsSearch.trim().length > 0;

  /** 过滤后的分区（visible 判定 + 搜索命中）；目录与正文渲染共用同一份结果。 */
  const visibleSections = useMemo(() => {
    const q = settingsSearch.trim().toLowerCase();
    const matchesSearch = (spec: SettingSpec): boolean => {
      if (!q) return true;
      const label = t(spec.labelKey).toLowerCase();
      const hint = spec.kind !== 'custom' && spec.hintKey ? t(spec.hintKey).toLowerCase() : '';
      if (label.includes(q) || hint.includes(q) || spec.labelKey.toLowerCase().includes(q)) {
        return true;
      }
      // 下拉选项文案也要参与匹配：像「最近访问」这样只存在于 select options 里的
      // 文案匹配不到时，用户会误判为「没有这个设置」。
      if (spec.kind === 'select') {
        return spec.options.some((option) => t(option.label).toLowerCase().includes(q));
      }
      return false;
    };
    return sections.map((section) => {
      // 分区标题也参与匹配：搜「分组」应当带回「分组与搜索」整个分区，
      // 而不只是命中标题里带这两个字的两三个设置项。
      // 只在有查询词时判定：`!q` 会让下面的三元恒真、分区命中分支永远走不到。
      const sectionHit = q.length > 0 && t(section.titleKey).toLowerCase().includes(q);
      return {
        section,
        specs: section.specs
          .filter((spec) => ('visible' in spec && spec.visible ? spec.visible(settings) : true))
          // 分区命中即整区保留；否则逐项匹配（无查询词时 matchesSearch 恒 true）。
          .filter((spec) => (sectionHit ? true : matchesSearch(spec)))
      };
    });
  }, [sections, settings, settingsSearch, t]);

  /** 目录条目：静态区块 + 当前可见的设置分区（被搜索过滤掉的分区不进目录，避免点了没反应）。 */
  const outlineItems = useMemo<OutlineItem[]>(() => {
    const dynamic: OutlineItem[] = visibleSections
      .filter((entry) => entry.specs.length > 0)
      // 锚点用 section.id（稳定标识），文案用 titleKey——两者不可混用
      .map(({ section }) => ({ id: section.id, label: t(section.titleKey) }));
    // 静态区块（预置 / 概念图 / 快捷键 / 数据 / 关于）按标题过滤：
    // 不参与过滤时，搜「导出」目录里仍挂着「数据」以外的块，点了不会有任何反应。
    const q = settingsSearch.trim().toLowerCase();
    const statics: OutlineItem[] = [
      { id: 'presets.title', label: t('快速预设') },
      { id: 'settings.capabilitiesGuide', label: t('你能做什么') },
      { id: 'fixedMap.title', label: t('固定概念一览') },
      { id: 'settings.shortcuts', label: t('快捷键') },
      { id: 'settings.data', label: t('数据备份') },
      { id: 'about.title', label: t('关于 Tabs') }
    ].filter((item) => !q || item.label.toLowerCase().includes(q));
    return [...statics.slice(0, 3), ...dynamic, ...statics.slice(3)];
  }, [t, visibleSections, settingsSearch]);

  if (!ready) {
    return (
      /* 与正式态共用同一外壳：加载态另用一个盒子时，ready 翻转会让容器宽度与
         上下留白同时变化。占位改用骨架屏，与侧栏列表同一套加载语言（此前是
         一行「设置加载中…」，两处加载态观感不同）。 */
      <div className="mx-auto flex max-w-5xl justify-center gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto min-w-0 max-w-2xl flex-1">
          <span className="sr-only" role="status">
            {t('设置加载中…')}
          </span>
          <div className="skeleton mb-6 h-9 w-44" />
          <div className="skeleton mb-6 h-10 w-full" />
          <div className="skeleton mb-3 h-4 w-24" />
          <div className="skeleton h-36 w-full" />
        </div>
      </div>
    );
  }

  return (
    /* 左目录 + 右正文：目录在 lg 以下隐藏（窄屏放不下侧栏，此时正文占满宽度）。
       justify-center：正文列被 max-w-2xl 卡住后，剩余空间原本全部堆在右侧，
       lg 以上空 112px、lg 以下空 180px，整页视觉左偏。 */
    /* 去掉 justify-center：目录 160 + gap 32 + 正文 672 = 864 居中于 1024 容器，
       剩余 160 平分两侧 → 正文列中心相对页面中心右偏 96px，宽屏下左右留白
       80 / 272 明显不对称。居中交给正文列的 mx-auto。 */
    <div className="mx-auto flex max-w-5xl gap-8 px-4 py-6 sm:px-6 sm:py-10">
      <SettingsOutline items={outlineItems} />
      <div className="mx-auto min-w-0 max-w-2xl flex-1">
        <header className="mb-4 flex items-start justify-between gap-3 sm:mb-6">
          <div className="flex items-start gap-3">
            <span className="elev-1 mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gray-200 bg-surface">
              <Icon d={Icons.settings} className="h-4 w-4 text-accent-600" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{t('设置')}</h1>
              {/* 12px：与关于页副标题（text-sm）同属「一级标题下一行」，10px 既低于
                  项目自订的正文下限，也与关于页差出 4px。 */}
              <p className="mt-0.5 text-xs text-gray-600">{t('个性化你的标签工作台')}</p>
            </div>
          </div>
          <Button variant="danger-ghost" onClick={() => setConfirmingReset(true)}>
            {t('恢复默认')}
          </Button>
        </header>

        {/* 页面级写入失败提示：紧贴页头，改哪一项都在同一屏内看到结果。
            导出/导入结果仍留在「数据备份」分区（那是该动作的发生地）。 */}
        {settingsStatus !== null && (
          <Callout
            role="status"
            aria-live="polite"
            tone="warn"
            density="page"
            className="mb-4"
            icon={Icons.infoAlert}
          >
            <p className="text-xs">{settingsStatus}</p>
          </Callout>
        )}

        {/* mb-6 sm:mb-8：与分区间距同档。恒为 24px 时在 sm 以上反而小于
            区块之间的 32px，层级关系倒置（"搜索框离首块更近"读起来像属于首块）。 */}
        <div className="mb-6 sm:mb-8">
          <TextField
            type="search"
            size="lg"
            /* 不再覆写圆角：同一个 TextField 在这里 8px、其余全部 4px。
               需要大圆角应走组件的 radius prop，不要在调用点硬改。 */
            className="elev-1"
            value={settingsSearch}
            onChange={setSettingsSearch}
            placeholder={t('搜索设置…')}
            ariaLabel={t('搜索设置…')}
          />
        </div>

        <div id="presets.title" className="scroll-mt-6">
          <PresetsPanel />
        </div>

        <div id="settings.capabilitiesGuide" className="scroll-mt-6">
          <CapabilitiesGuide />
        </div>

        <Section id="fixedMap.title" title={t('固定概念一览')}>
          <div className="p-4">
            <FixedConceptsMap />
          </div>
        </Section>

        {isSearching && visibleSections.every((entry) => entry.specs.length === 0) && (
          /* 搜索无命中的空态反馈：所有分区静默消失时，用户分不清
             「没有这个设置」还是「搜索没生效」。 */
          <p className="mb-4 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-xs text-gray-500">
            {t('没有找到匹配的设置')}
          </p>
        )}
        {visibleSections.map(({ section, specs }) => {
          if (specs.length === 0) return null;
          return (
            <Section
              key={section.id}
              id={section.id}
              title={t(section.titleKey)}
              count={specs.length}
            >
              {specs.map((spec) => (
                <SettingRow key={spec.labelKey} spec={spec} settings={settings} update={update} />
              ))}
            </Section>
          );
        })}

        <div id="settings.shortcuts" className="scroll-mt-6">
          <ShortcutsSection onOpenShortcutSettings={openShortcutSettings} />
        </div>

        <Section id="settings.data" title={t('数据备份')}>
          <Row
            label={t('导出本地数据')}
            hint={t(
              '导出文件夹、常驻磁贴、折叠状态、设置，以及全部快照与归档；不包含当前打开的标签与撤销记录'
            )}
          >
            <Button variant="secondary" onClick={() => void handleExport()}>
              {t('导出备份')}
            </Button>
          </Row>
          <Row
            label={t('导入本地数据')}
            hint={t(
              '先在本地校验 JSON，再覆盖导出范围内的数据，不会修改当前打开的标签；任一分区写入失败会整体回滚'
            )}
          >
            <>
              {/* 裸 <input type="file"> 的显式豁免：ui 层没有 FilePicker 原语，
                  本元素只是被上方「导入 JSON」按钮以 ref.click() 触发的隐藏文件
                  选择器，不承载任何视觉形态，故不套 TextField / Button。 */}
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                disabled={importing}
                onChange={(event) => void handleImport(event)}
              />
              {/* 事务进行中禁用入口：并发导入会被 importData 拒绝（只能看到一个泛化的
                「操作失败」），不如直接让用户点不动。 */}
              <Button
                variant="secondary"
                disabled={importing}
                onClick={() => importInputRef.current?.click()}
              >
                {t('导入 JSON')}
              </Button>
            </>
          </Row>
          <Row
            label={t('从书签导入文件夹')}
            hint={t('将书签栏顶层文件夹导入为收藏夹的文件夹（同名合并、网址全局去重）')}
          >
            <Button variant="secondary" onClick={handleImportBookmarks}>
              {t('导入')}
            </Button>
          </Row>
          {/* 导出引导：**不依赖 onboarded** —— 引导只在首次运行时出现，
              而「卸载即丢数据」的风险对每个用户、每次打开设置页都存在。 */}
          <div className="mx-4 mb-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <p className="font-medium text-gray-700">{t('建议定期导出备份')}</p>
            <p className="mt-0.5">
              {t(
                'Tabs 没有服务器：数据只存在这台设备的浏览器里。卸载扩展、清除浏览数据或重置浏览器配置都会一并删除它们，且无法找回。建议定期导出一份备份文件。'
              )}
            </p>
          </div>
          <Row
            label={t('导出诊断信息')}
            hint={
              quarantineCount > 0
                ? t(
                    '把最近记录的降级情况另存为本地报告（仅含时间与错误描述，不含页面标题与网址），便于反馈问题时附带。坏数据隔离区另有 {{count}} 条留档，会一并导出',
                    { count: quarantineCount }
                  )
                : t(
                    '把最近记录的降级情况另存为本地报告（仅含时间与错误描述，不含页面标题与网址），便于反馈问题时附带'
                  )
            }
          >
            <Button variant="secondary" onClick={() => void handleExportDiagnostics()}>
              {t('导出报告')}
            </Button>
          </Row>
          <Row
            label={t('清除所有数据')}
            hint={t(
              '删除收藏夹、常驻磁贴、全部快照与归档、撤销栈和跨设备同步镜像，设置恢复默认；操作不可恢复'
            )}
          >
            <Button
              variant="danger-ghost"
              onClick={() => {
                setClearAck(false);
                setConfirmingClear(true);
              }}
            >
              {t('永久清除')}
            </Button>
          </Row>
          {transferStatus && (
            /* 操作结果对读屏播报（与侧边栏搜索命中数同口径：<output> + aria-live） */
            <output className="px-4 py-2 text-xs text-gray-600" role="status" aria-live="polite">
              {transferStatus}
            </output>
          )}
        </Section>

        {/* 关于：能力总览在独立页面（宽版式的能力网格），设置页只放入口 */}
        <Section id="about.title" title={t('关于 Tabs')}>
          <Row
            label={t('本地优先、无账号、无云端的标签工作台')}
            hint={t('打开独立页面，完整浏览产品的全部能力与快捷键')}
          >
            <Button variant="secondary" onClick={openAboutPage}>
              {t('查看能力总览')}
            </Button>
          </Row>
        </Section>

        {pendingImport !== null && (
          <ConfirmDialog
            title={t('导入备份')}
            message={t('导入会覆盖你的常驻磁贴、文件夹、设置与快照，是否继续？')}
            confirmLabel={t('导入')}
            danger
            onCancel={() => setPendingImport(null)}
            onConfirm={runImport}
          />
        )}

        {confirmingReset && (
          <ConfirmDialog
            title={t('恢复默认设置')}
            message={t('将把全部设置恢复为默认值，是否继续？')}
            confirmLabel={t('恢复默认')}
            danger
            onCancel={() => setConfirmingReset(false)}
            onConfirm={handleResetSettings}
          />
        )}

        <ClearDataDialog
          open={confirmingClear}
          onClose={() => {
            setConfirmingClear(false);
            setClearAck(false);
          }}
          onConfirm={handleClearData}
          ack={clearAck}
          onAckChange={setClearAck}
          onExportBackup={() => void handleExport()}
        />
      </div>
    </div>
  );
}
