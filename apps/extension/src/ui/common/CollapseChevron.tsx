import { Icon, Icons } from '@/ui/common/Icon';

/** 折叠箭头（唯一形态）：分组头 / 文件夹头 / 快照详情开关共用，旋转方向由 `collapsed` 一处决定。 */
export function CollapseChevron({
  collapsed,
  className = 'h-3.5 w-3.5'
}: {
  /** true = 收起（箭头朝右）；false = 展开（箭头朝下）。 */
  collapsed: boolean;
  /** 图标尺寸类（默认 14px；磁贴/卡片内联更小时可覆盖）。 */
  className?: string;
}) {
  return (
    <Icon
      d={Icons.chevron}
      className={className + ' transition-transform' + (collapsed ? '' : ' rotate-90')}
    />
  );
}
