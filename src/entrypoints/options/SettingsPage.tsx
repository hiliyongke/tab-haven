import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDataStore } from '@/stores/dataStore';
import { useUndoStore } from '@/stores/undoStore';
import { useSnapshotStore } from '@/stores/snapshotStore';
import type { Settings } from '@/core/schema/models';
import { Button } from '@/ui/common/Button';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { FixedConceptsMap } from '@/ui/common/FixedConceptsMap';
import { TextField } from '@/ui/common/TextField';
import { Toggle } from '@/ui/common/Toggle';
import { clearDiagnostics, exportDiagnostics, readAllDiagnostics } from '@/platform/diagnostics';
import { getSidePanelSide, type SidePanelSide } from '@/platform/sidePanel';
import { openUrlInTab } from '@/platform/navigation';
import { Row, Section } from '@/entrypoints/options/settingControls';
import { buildSections, SettingRow, type SettingSpec } from '@/entrypoints/options/settingSections';
import { CapabilitiesGuide, PresetsPanel } from '@/entrypoints/options/settingPresets';
import { ShortcutsSection } from '@/entrypoints/options/ShortcutsSection';
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

  useEffect(() => {
    let cancelled = false;
    void getSidePanelSide()
      .then((side) => {
        if (!cancelled) setSidePanelSide(side);
      })
      .catch(() => {
        if (!cancelled) setSidePanelSide('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 设置页的唯一写入通道。
   *
   * 失败必须在页面上说清楚：设置是跨会话行为契约，写盘失败时 store 不会变更，
   * 界面会静默弹回旧值——用户只会觉得「开关点不动」，而不会知道数据根本没保存。
   */
  const update = (key: keyof Settings, value: unknown) => {
    void tryUpdateSettings({ [key]: value } as Partial<Settings>).then((ok) => {
      if (!ok) setTransferStatus(t('settings.saveFailed'));
    });
  };

  const handleExport = async () => {
    try {
      const payload = JSON.stringify(await exportData(), null, 2);
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `tabs-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setTransferStatus(t('settings.exportSuccess'));
    } catch {
      // 快照读取或序列化失败：宁可明确报错，也不能给出一份内容不全的备份。
      setTransferStatus(t('settings.exportFailed'));
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // 体积上限：备份是纯 JSON，5MB 已远超正常使用规模；不设限会让超大文件
    // 在 file.text() 阶段直接卡死设置页。
    if (file.size > MAX_IMPORT_BYTES) {
      setTransferStatus(t('settings.importFailed'));
      return;
    }
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
      if (entries.length === 0) {
        setTransferStatus(t('settings.diagnosticsEmpty'));
        return;
      }
      const url = URL.createObjectURL(
        new Blob([exportDiagnostics(entries)], { type: 'application/json' })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `tabs-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      await clearDiagnostics();
      setTransferStatus(t('settings.exportSuccess'));
    } catch {
      setTransferStatus(t('settings.exportFailed'));
    }
  };

  /** 恢复全部设置为默认值（带确认弹窗）。 */
  const handleResetSettings = () => {
    void resetSettings()
      .then(() => setTransferStatus(t('settings.resetDone')))
      .catch(() => setTransferStatus(t('settings.resetFailed')));
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
        setTransferStatus(t('settings.clearDataDone'));
      })
      .catch(() => setTransferStatus(t('settings.clearDataFailed')));
    setConfirmingClear(false);
    setClearAck(false);
  };

  // 分组配置见 settingSections.ts 的 buildSections。此处再 memo 一层：配置约 370 行且含大量
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

      <ShortcutsSection onOpenShortcutSettings={openShortcutSettings} />

      <Section title={t('settings.data')}>
        <Row label={t('settings.exportData')} hint={t('settings.exportDataHint')}>
          <Button variant="secondary" onClick={() => void handleExport()}>
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
              {t('settings.import')}
            </Button>
          </>
        </Row>
        <Row label={t('settings.importBookmarks')} hint={t('settings.importBookmarksHint')}>
          <Button variant="secondary" onClick={handleImportBookmarks}>
            {t('settings.importBookmarksAction')}
          </Button>
        </Row>
        <Row label={t('settings.syncMirror')} hint={t('settings.syncMirrorHint')}>
          <Toggle
            checked={settings.syncMirrorEnabled}
            onChange={(checked) => update('syncMirrorEnabled', checked)}
            ariaLabel={t('settings.syncMirror')}
          />
        </Row>
        <Row label={t('settings.exportDiagnostics')} hint={t('settings.exportDiagnosticsHint')}>
          <Button variant="secondary" onClick={() => void handleExportDiagnostics()}>
            {t('settings.export')}
          </Button>
        </Row>
        <Row label={t('settings.clearData')} hint={t('settings.clearDataHint')}>
          <Button
            variant="danger-ghost"
            onClick={() => {
              setClearAck(false);
              setConfirmingClear(true);
            }}
          >
            {t('settings.clearDataAction')}
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
  );
}
