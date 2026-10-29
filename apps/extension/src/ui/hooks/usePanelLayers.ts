import { useCallback, useState } from 'react';

/**
 * 面板弹层的当前层（互斥）。
 *
 * 用判别联合表达互斥：「互斥」由类型保证，切换是一次赋值，打开快照必须连带指定视图。
 * 引导（`showTour`）刻意在联合外：它是覆盖式的，可与任一层同时显示。
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
