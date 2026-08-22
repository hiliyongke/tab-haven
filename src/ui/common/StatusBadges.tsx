import type { TabRecord } from '@/core/tab-types';

/** 标签行状态徽章（n× 重复 / 静音 / 拆分指示）。 */
export function StatusBadges({
  tab,
  duplicateCount,
  isSplitCompanion
}: {
  tab: TabRecord;
  duplicateCount: number;
  isSplitCompanion: boolean;
}) {
  const badges: React.ReactNode[] = [];

  if (duplicateCount > 1) {
    badges.push(
      <span
        key="dup"
        className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700"
        title={`此网址在当前窗口共有 ${duplicateCount} 份`}
      >
        {duplicateCount}×
      </span>
    );
  }

  if (tab.muted) {
    badges.push(
      <span key="muted" className="text-[10px] text-gray-400" title="已静音">
        静
      </span>
    );
  }

  if (tab.splitViewId !== undefined) {
    badges.push(
      <span
        key="split"
        className="rounded border border-dashed border-blue-400 px-0.5 text-[10px] text-blue-500"
        title="正在拆分视图中显示"
      >
        拆
      </span>
    );
  }

  if (isSplitCompanion) {
    badges.push(
      <span
        key="companion"
        className="rounded bg-blue-50 px-0.5 text-[10px] text-blue-400"
        title="与当前标签拆分同屏"
      >
        伴
      </span>
    );
  }

  if (badges.length === 0) return null;
  return <span className="flex shrink-0 items-center gap-1">{badges}</span>;
}
