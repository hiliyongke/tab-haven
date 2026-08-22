import type { ReactElement } from 'react';

/**
 * 场景卡的四幅小插画（96×96 网格，令牌着色）。
 *
 * 小尺寸下只画"能认出来的形状"：文档堆、文件夹+磁贴、归档箱、爆掉的标签条。
 * 笔画与 lucide 对齐（1.75），细节超过两笔就会糊。
 */
export type ScenarioArtName = 'research' | 'project' | 'wrapup' | 'overload';

/** 查资料：一摞文档 + 放大镜 */
function ResearchArt() {
  return (
    <svg className="art scenario-art" viewBox="0 0 96 96" aria-hidden="true">
      <rect x="16" y="14" width="46" height="58" rx="6" className="a-canvas" />
      <rect x="16" y="14" width="46" height="58" rx="6" fill="none" className="a-stroke-line" />
      <rect x="30" y="10" width="46" height="58" rx="6" className="a-surface" />
      <rect x="30" y="10" width="46" height="58" rx="6" fill="none" className="a-stroke-control" />
      <path d="M40 26h26M40 36h26M40 46h18" className="a-stroke-dim" strokeWidth="1.4" />
      <circle cx="66" cy="60" r="13" className="a-brand-soft" />
      <circle cx="66" cy="60" r="13" fill="none" className="a-stroke-brand" />
      <path d="M75 69l8 8" className="a-stroke-brand" />
    </svg>
  );
}

/** 跟进项目：文件夹 + 磁贴网格 */
function ProjectArt() {
  return (
    <svg className="art scenario-art" viewBox="0 0 96 96" aria-hidden="true">
      <path
        d="M14 26a6 6 0 0 1 6-6h18l8 8h30a6 6 0 0 1 6 6v34a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z"
        className="a-brand-soft"
      />
      <path
        d="M14 26a6 6 0 0 1 6-6h18l8 8h30a6 6 0 0 1 6 6v34a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z"
        fill="none"
        className="a-stroke-brand"
      />
      <rect x="26" y="46" width="16" height="16" rx="4" className="a-brand" />
      <rect x="48" y="46" width="16" height="16" rx="4" className="a-brand-dim" />
      <rect x="70" y="46" width="16" height="16" rx="4" className="a-neutral-soft" />
    </svg>
  );
}

/** 收尾归档：归档箱 + 时钟 */
function WrapUpArt() {
  return (
    <svg className="art scenario-art" viewBox="0 0 96 96" aria-hidden="true">
      <rect x="12" y="30" width="58" height="48" rx="8" className="a-canvas" />
      <rect x="12" y="30" width="58" height="48" rx="8" fill="none" className="a-stroke-line" />
      <path d="M12 44h58" className="a-stroke-line" />
      <rect x="26" y="54" width="30" height="5" rx="2.5" className="a-brand-dim" />
      <rect x="26" y="63" width="20" height="4" rx="2" className="a-mute" />
      {/* 时钟：关窗自动留档 */}
      <circle cx="70" cy="34" r="16" className="a-surface" />
      <circle cx="70" cy="34" r="16" fill="none" className="a-stroke-brand" />
      <path d="M70 26v8l6 4" fill="none" className="a-stroke-brand" />
    </svg>
  );
}

/** 标签爆炸：挤成一条的标签 + 清理扫帚 */
function OverloadArt() {
  return (
    <svg className="art scenario-art" viewBox="0 0 96 96" aria-hidden="true">
      <rect x="10" y="20" width="76" height="18" rx="6" className="a-canvas" />
      <rect x="10" y="20" width="76" height="18" rx="6" fill="none" className="a-stroke-line" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect
          key={i}
          x={15 + i * 12}
          y={24}
          width="9"
          height="10"
          rx="2.5"
          className={i === 2 ? 'a-brand' : 'a-neutral-soft'}
        />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={15 + i * 12}
          y={54}
          width="9"
          height="10"
          rx="2.5"
          className="a-brand-dim"
        />
      ))}
      {/* 扫帚：一键去重 */}
      <path d="M62 78l16-16" className="a-stroke-brand" strokeWidth="2" />
      <path d="M70 54l10 10-8 8-10-10z" className="a-brand-soft" />
      <path d="M70 54l10 10-8 8-10-10z" fill="none" className="a-stroke-brand" />
    </svg>
  );
}

export const SCENARIO_ART: Record<ScenarioArtName, () => ReactElement> = {
  research: ResearchArt,
  project: ProjectArt,
  wrapup: WrapUpArt,
  overload: OverloadArt
};
