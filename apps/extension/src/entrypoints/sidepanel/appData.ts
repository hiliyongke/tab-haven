/** 初始化失败后的自动重试延迟：给仓库读取一次喘息，避免在同一故障上立刻重试。 */
export const INIT_RETRY_DELAY_MS = 1000;
/** 自动重试次数上限（含首次）。用尽即转错误态，交回用户手动重试。 */
export const INIT_MAX_ATTEMPTS = 2;
/** 首启引导延迟：数据就绪后先让用户看到真实列表，避免遮罩盖住被介绍对象。 */
export const TOUR_AUTO_OPEN_DELAY_MS = 900;

/**
 * 习惯洞察条数：重复重灾区 + 可休眠（有则计一）+ 滞留标签。
 * 与 SnapshotsPanel 内 computeInsights 同源同参，徽章数量必须等于打开后看到的条目数。
 */
export function countInsights(insights: {
  duplicateHotspots: readonly unknown[];
  discardableCount: number;
  staleTabs: readonly unknown[];
}): number {
  return (
    insights.duplicateHotspots.length +
    (insights.discardableCount > 0 ? 1 : 0) +
    insights.staleTabs.length
  );
}
