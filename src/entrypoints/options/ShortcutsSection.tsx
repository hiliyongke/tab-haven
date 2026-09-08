import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/common/Button';
import { Row, Section } from '@/entrypoints/options/settingControls';

/**
 * 平台修饰键判定：Mac 用户应看到 ⌃⇧ 而非 Ctrl+Shift。
 * 模块顶层常量：navigator.platform 每次渲染求值且该 API 已废弃，
 * 结果在会话内不会变化，无理由反复读取。
 */
const IS_MAC = /mac/i.test(globalThis.navigator?.platform ?? '');

/** 快捷键说明区：按平台渲染修饰键（mac 显示 ⌃⇧ 符号，Windows/Linux 显示 Ctrl+Shift 文案）。 */
export function ShortcutsSection({
  onOpenShortcutSettings
}: {
  onOpenShortcutSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t('settings.shortcuts')}>
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
        <Button variant="secondary" onClick={onOpenShortcutSettings}>
          {t('settings.shortcutCustomizeAction')}
        </Button>
      </Row>
    </Section>
  );
}
