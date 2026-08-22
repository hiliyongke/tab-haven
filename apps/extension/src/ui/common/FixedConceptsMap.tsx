import { useTranslation } from '@/i18n';
import { Icon, Icons } from '@/ui/common/Icon';

/**
 * 固定概念心智地图：用紧凑的三段卡片把「常驻磁贴 /
 * 文件夹 / 浏览器固定标签」的区别与适用场景讲清，消解 5 种固定语义的认知混乱。
 * 纯展示组件，不依赖任何业务状态。
 */
export function FixedConceptsMap({ className }: { className?: string }) {
  const { t } = useTranslation();
  const items = [
    { icon: Icons.pin, name: t('常驻磁贴'), how: t('随时切换的常用页；拖到顶部磁贴条，一点直达') },
    { icon: Icons.folder, name: t('文件夹'), how: t('长期保存的容器；拖入标签或分组，按主题归类') },
    {
      icon: Icons.anchor,
      name: t('浏览器固定标签'),
      how: t('由浏览器固定，不参与临时区聚合与自动休眠；与其他标签分开显示')
    }
  ];
  return (
    <div className={className}>
      <p className="px-1 pb-1.5 text-3xs font-medium text-gray-500">{t('固定概念一览')}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          // 刻意不加边框、背景压到 gray-50：这组条目纯展示、无任何点击行为，
          // 带 border 的卡片外观会让用户误以为可点（点了没反应），属于错误的可交互暗示。
          <li key={item.name} className="flex items-start gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent-50 text-accent-600">
              <Icon d={item.icon} className="h-3 w-3" />
            </span>
            <div className="min-w-0">
              <p className="text-3xs font-semibold text-gray-700">{item.name}</p>
              <p className="mt-0.5 text-3xs leading-snug text-gray-600">{item.how}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="px-1 pt-1.5 text-3xs leading-snug text-gray-600">
        {t('原生标签组是浏览器分组，不属于以上任何一种')}
      </p>
    </div>
  );
}
