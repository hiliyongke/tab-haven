import { useTranslation } from '@/i18n';
import { Button } from '@/ui/common/Button';
import { Kbd } from '@/ui/common/Kbd';
import { COMMANDS, formatCommandKeys } from '@/core/commands';
import { Row, Section } from '@/ui/settings/settingControls';

/**
 * 平台修饰键判定：Mac 用户应看到 ⌃⇧ 而非 Ctrl+Shift。
 * 模块顶层常量：navigator.platform 每次渲染求值且该 API 已废弃，
 * 结果在会话内不会变化，无理由反复读取。
 */
const IS_MAC = /mac/i.test(globalThis.navigator?.platform ?? '');

/** 侧边栏内快捷键修饰键：只给当前平台那一套写法，不在同一行里并列两套。 */
const modKey = (key: string): string => (IS_MAC ? `⌘${key}` : `Ctrl+${key}`);
/** 带 Shift 的组合键同理。 */
const modShiftKey = (key: string): string => (IS_MAC ? `⌘⇧${key}` : `Ctrl+Shift+${key}`);

/** 快捷键说明区：按平台渲染修饰键（mac 显示 ⌃⇧ 符号，Windows/Linux 显示 Ctrl+Shift 文案）。 */
export function ShortcutsSection({
  onOpenShortcutSettings
}: {
  onOpenShortcutSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t('快捷键')}>
      {/* 浏览器级快捷键：键位与说明同源于 core/commands（与 manifest 的口径由守卫对齐） */}
      {COMMANDS.map((command) => (
        <Row
          key={command.id}
          label={<Kbd>{formatCommandKeys(command.suggestedKey, IS_MAC)}</Kbd>}
          hint={t(command.labelKey)}
        >
          <span className="text-3xs text-gray-500">{t('浏览器级')}</span>
        </Row>
      ))}
      <Row label={<Kbd>{modKey('K')}</Kbd>} hint={t('聚焦搜索')}>
        <span className="text-3xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>{modKey('P')}</Kbd>} hint={t('打开命令面板')}>
        <span className="text-3xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>{modKey('J')}</Kbd>} hint={t('定位当前标签')}>
        <span className="text-3xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>{modKey('Z')}</Kbd>} hint={t('撤销最近关闭')}>
        <span className="text-3xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row
        label={<Kbd>{modShiftKey('Z')}</Kbd>}
        hint={t('重做最近一次撤销（再次关闭刚恢复的标签）')}
      >
        <span className="text-3xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>↑ ↓ Enter</Kbd>} hint={t('在列表中漫游 / 激活')}>
        <span className="text-3xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>Alt ↑/↓</Kbd>} hint={t('重排当前标签')}>
        <span className="text-3xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>Space</Kbd>} hint={t('键盘拖拽')}>
        <span className="text-3xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={t('自定义快捷键')} hint={t('在浏览器「扩展快捷键」设置页中调整按键')}>
        <Button variant="secondary" onClick={onOpenShortcutSettings}>
          {t('打开浏览器快捷键设置')}
        </Button>
      </Row>
    </Section>
  );
}
