import { useTranslation } from 'react-i18next';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 固定概念心智地图（P1「固定」概念收敛）：用紧凑的三段卡片把「常驻磁贴 /
 * 收藏夹 / 浏览器固定标签」的区别与适用场景讲清，消解 5 种固定语义的认知混乱。
 * 纯展示组件，不依赖任何业务状态。
 */
export function FixedConceptsMap({ className }: { className?: string }) {
  const { t } = useTranslation();
  const items = [
    { icon: Icons.pin, name: t('fixedMap.tilesName'), how: t('fixedMap.tilesHow') },
    { icon: Icons.folder, name: t('fixedMap.collName'), how: t('fixedMap.collHow') },
    { icon: Icons.shield, name: t('fixedMap.nativeName'), how: t('fixedMap.nativeHow') }
  ];
  return (
    <div className={className}>
      <p className="px-1 pb-1.5 text-2xs font-medium text-gray-500">{t('fixedMap.title')}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.name} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-surface px-2.5 py-2">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-600">
              <Icon d={item.icon} className="h-3 w-3" />
            </span>
            <div className="min-w-0">
              <p className="text-2xs font-semibold text-gray-700">{item.name}</p>
              <p className="mt-0.5 text-2xs leading-snug text-gray-600">{item.how}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="px-1 pt-1.5 text-2xs leading-snug text-gray-600">{t('fixedMap.note')}</p>
    </div>
  );
}
