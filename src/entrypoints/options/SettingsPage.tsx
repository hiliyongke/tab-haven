import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { useDataStore } from '@/stores/dataStore';
import { useUndoStore } from '@/stores/undoStore';
import type { Settings } from '@/core/schema/models';
import { Button } from '@/ui/common/Button';
import { ConfirmDialog, DialogShell } from '@/ui/dialog/Dialog';
import { Icon, Icons } from '@/ui/common/Icon';
import { FixedConceptsMap } from '@/ui/common/FixedConceptsMap';
import { TextField } from '@/ui/common/TextField';
import { Toggle } from '@/ui/common/Toggle';
import { Row, Section } from '@/entrypoints/options/settingControls';
import { buildSections, SettingRow, type SettingSpec } from '@/entrypoints/options/settingSections';
import {
  CapabilitiesGuide,
  PresetsPanel
} from '@/entrypoints/options/settingPresets';

/**
 * 设置页**编排层**：状态、写盘通道与弹窗流转。
 *
 * 已按职责拆分（自上而下单向依赖）：
 *  - `settingControls.tsx` —— 展示层控件（分区 / 行容器 / 编辑器），叶子；
 *  - `settingSections.tsx` —— 声明式配置（buildSections + SettingRow）；
 *  - `settingPresets.tsx` —— 引导层（预设画像 / 能力发现）；
 *  - 本文件 —— 只做状态编排与 JSX 组装，不再承载任何配置体。
 */

type SidePanelSide = 'left' | 'right' | 'unknown';
type SidePanelLayoutApi = { getLayout?: () => Promise<{ side: 'left' | 'right' }> };

/** 导入文件体积上限（5MB）：备份为纯 JSON，此上限已远超正常使用规模。 */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

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
    void browser.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {});
  };

  /** 恢复全部设置为默认值（带确认弹窗）。 */
  const handleResetSettings = () => {
    void resetSettings()
      .then(() => setTransferStatus(t('settings.resetDone')))
      .catch(() => setTransferStatus(t('settings.resetFailed')));
    setConfirmingReset(false);
  };

  /** 清除所有数据：store 清仓库/会话/镜像，撤销栈由 UI 层同步清空（被清除的数据不参与撤销）。 */
  const handleClearData = () => {
    void clearAllData()
      .then(() => {
        void useUndoStore.getState().clearBatches();
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
        <Row label="⌘P / Ctrl+P" hint={t('settings.shortcutPalette')}>
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
        <Row label={t('settings.syncMirror')} hint={t('settings.syncMirrorHint')}>
          <Toggle
            checked={settings.syncMirrorEnabled}
            onChange={(checked) => update('syncMirrorEnabled', checked)}
            ariaLabel={t('settings.syncMirror')}
          />
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

      {confirmingClear && (
        <DialogShell
          title={t('settings.clearDataTitle')}
          onClose={() => {
            setConfirmingClear(false);
            setClearAck(false);
          }}
        >
          <div className="flex flex-col gap-3">
            <p className="text-3xs leading-relaxed text-gray-600">{t('settings.clearDataDesc')}</p>
            <ul className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-2xs text-gray-700">
              <li>· {t('settings.clearDataItemFolders')}</li>
              <li>· {t('settings.clearDataItemSnapshots')}</li>
              <li>· {t('settings.clearDataItemUndo')}</li>
              <li>· {t('settings.clearDataItemSettings')}</li>
              <li>· {t('settings.clearDataItemSync')}</li>
            </ul>
            <p className="text-2xs font-medium text-warn-700">
              {t('settings.clearDataIrreversible')}
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-2xs text-gray-700">
              <input
                type="checkbox"
                checked={clearAck}
                onChange={(event) => setClearAck(event.target.checked)}
                className="mt-px"
              />
              <span>{t('settings.clearDataAck')}</span>
            </label>
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={handleExport}>
                {t('settings.exportBackupFirst')}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setConfirmingClear(false);
                    setClearAck(false);
                  }}
                >
                  {t('dialog.cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!clearAck}
                  onClick={() => void handleClearData()}
                >
                  {t('settings.clearDataAction')}
                </Button>
              </div>
            </div>
          </div>
        </DialogShell>
      )}
    </div>
  );
}
