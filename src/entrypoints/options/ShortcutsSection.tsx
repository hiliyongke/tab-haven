import { useTranslation } from '@/i18n';
import { Button } from '@/ui/common/Button';
import { Kbd } from '@/ui/common/Kbd';
import { Row, Section } from '@/entrypoints/options/settingControls';

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
      {(
        [
          ['F', t('聚焦搜索')],
          ['O', t('打开 / 聚焦侧边栏')],
          ['L', t('定位当前激活标签')],
          ['U', t('休眠当前窗口的后台标签')]
        ] as const
      ).map(([key, hint]) => (
        <Row key={key} label={<Kbd>{IS_MAC ? `⌃⇧${key}` : `Ctrl+Shift+${key}`}</Kbd>} hint={hint}>
          <span className="text-2xs text-gray-500">{t('浏览器级')}</span>
        </Row>
      ))}
      <Row label={<Kbd>{modKey('K')}</Kbd>} hint={t('侧边栏内聚焦搜索')}>
        <span className="text-2xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>{modKey('P')}</Kbd>} hint={t('侧边栏内打开命令面板（搜索并直接执行动作）')}>
        <span className="text-2xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>{modKey('J')}</Kbd>} hint={t('侧边栏内定位激活标签')}>
        <span className="text-2xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={<Kbd>{modKey('Z')}</Kbd>} hint={t('侧边栏内撤销最近一次关闭')}>
        <span className="text-2xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row
        label={<Kbd>{modShiftKey('Z')}</Kbd>}
        hint={t('侧边栏内重做最近一次撤销（再次关闭刚恢复的标签）')}
      >
        <span className="text-2xs text-gray-500">{t('侧边栏内')}</span>
      </Row>
      <Row label={t('自定义快捷键')} hint={t('在浏览器「扩展快捷键」设置页中调整按键')}>
        <Button variant="secondary" onClick={onOpenShortcutSettings}>
          {t('打开浏览器快捷键设置')}
        </Button>
      </Row>
    </Section>
  );
}
