import { useCallback, useState } from 'react';

/**
 * 面板弹层的当前层（互斥）。
 *
 * 原先是 `showHistory` / `showPalette` / `showSnapshots` 三个独立 boolean 加一个
 * `snapshotView`：四个状态表达「现在开着哪一层」，而它们**本应互斥** —— 三个
 * boolean 可以任意组合出「历史与快照同时打开」这类不可能由 UI 产生、也无法自愈
 * 的中间态；切换时要写 `setShowHistory(false); setShowSnapshots(true);` 两行，
 * 漏掉第一行就留下两层叠加的残留。
 *
 * 收敛成一个判别联合后：「互斥」由类型保证，切换是一次赋值，且打开快照时必须
 * 连带指定视图（视图不再是与开关分离、可以停留在上一次值的独立状态）。
 *
 * 引导（`showTour`）刻意**不在**本联合里：它是覆盖式引导，可以与任一层同时显示，
 * 硬并入互斥集会把它挤掉。
 */
type PanelLayer =
  | { kind: 'none' }
  | { kind: 'history' }
  | { kind: 'palette' }
  /** `view`：'list' 常规打开；'report' 从底栏洞察入口直达周报区块。 */
  | { kind: 'snapshots'; view: 'list' | 'report' };

export function usePanelLayers(): {
  layer: PanelLayer;
  openHistory: () => void;
  openPalette: () => void;
  openSnapshots: (view: 'list' | 'report') => void;
  closeLayer: () => void;
} {
  const [layer, setLayer] = useState<PanelLayer>({ kind: 'none' });
  const openHistory = useCallback(() => setLayer({ kind: 'history' }), []);
  const openPalette = useCallback(() => setLayer({ kind: 'palette' }), []);
  const openSnapshots = useCallback(
    (view: 'list' | 'report') => setLayer({ kind: 'snapshots', view }),
    []
  );
  const closeLayer = useCallback(() => setLayer({ kind: 'none' }), []);
  return { layer, openHistory, openPalette, openSnapshots, closeLayer };
}
