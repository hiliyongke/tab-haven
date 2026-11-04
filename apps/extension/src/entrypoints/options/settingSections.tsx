import { useState } from 'react';
import { useTranslation } from '@/i18n';
import type { Settings } from '@/core/schema/models';
import { ConfirmDialog } from '@/ui/dialog/Dialog';
import { Select } from '@/ui/common/Select';
import { Toggle } from '@/ui/common/Toggle';
import { Row } from '@/ui/settings/settingControls';
import type { BooleanSettingKey, SettingSpec } from './settingSectionsContent';

/**
 * 设置页的公开出口：统一渲染器（SettingRow）在此，声明式配置见 settingSectionsContent.tsx。
 * 与 settingControls.tsx（展示控件）分层，避免 render 闭包与编辑器组件循环引用。
 */
export { buildSections, MirrorSyncStatus } from './settingSectionsContent';
export type { SettingSpec };

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

  // custom 行的存废由 render 决定：判 null 而非判空（0/'' 是合法空渲染，null 才表示不渲染），
  // 否则「同步状态」这类无依据的行会留下标题 + 空白值的常驻哑行。
  const rendered = spec.render({ settings, update, t });
  if (rendered === null) return null;

  return (
    <Row label={label} hint={spec.hintKey ? t(spec.hintKey) : undefined}>
      {rendered}
    </Row>
  );
}
