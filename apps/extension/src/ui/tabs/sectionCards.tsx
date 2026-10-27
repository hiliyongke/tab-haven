import { memo } from 'react';
import type { TemporarySection } from '@/core/site/Sections';
import { GroupCard } from '@/ui/common/GroupCard';
import { CollapsibleSectionCard } from '@/ui/tabs/CollapsibleSectionCard';
import { SectionRows } from '@/ui/tabs/rowList';
import { isSortableDisabled, sectionDragDataFor, useSectionAccent } from '@/ui/tabs/sectionAccent';
import type { SectionCardProps } from '@/ui/tabs/sectionTypes';

/** 未分组：普通标签整行列表。 */
const UngroupedSectionCard = memo(function UngroupedSectionCard({
  section,
  ...rowProps
}: Omit<SectionCardProps, 'section'> & {
  section: Extract<TemporarySection, { kind: 'ungrouped' }>;
}) {
  const accent = useSectionAccent(section);
  return (
    <GroupCard
      id={section.key}
      dragData={sectionDragDataFor(section)}
      disabled={isSortableDisabled(section)}
      title={section.title}
      count={section.tabs.length}
      accent={accent}
    >
      <div className="section-body">
        <SectionRows
          tabs={section.tabs}
          depths={section.depths}
          containerKey={section.key}
          {...rowProps}
        />
      </div>
    </GroupCard>
  );
});

/**
 * 单个分组卡片：按类型分发到未分组 / 可折叠（原生组 + 站点组）子组件。
 *
 * 本文件只留**分发**：行列表在 `rowList`、可折叠卡在 `CollapsibleSectionCard`、
 * 强调色与拖拽数据在 `sectionAccent`。三者互不复用，拆开后各自的改动面收敛到
 * 一个文件（原 539 行里改一次折叠逻辑要跨三段 JSX）。
 *
 * 连同两个子卡一起 memo：只有分组卡稳定，叶子 TabRow / RowItem 的 memo 浅比较才有收益。
 * 浏览器置顶（pinned）由 App 层 CategoryModule 单独渲染，不会进入本列表。
 */
const SectionCard = memo(function SectionCard(props: SectionCardProps) {
  const { section } = props;
  if (section.kind === 'pinned') return null;
  if (section.kind === 'ungrouped') return <UngroupedSectionCard {...props} section={section} />;
  // 走到这里 section 已收窄为 native | site
  return <CollapsibleSectionCard {...props} section={section} />;
});

export { SectionCard };
