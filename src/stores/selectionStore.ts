import { create } from 'zustand';

/**
 * 多选状态（FR-D1.1）：进入选择模式、shift 连选、cmd 点选、全选。
 * 选中集保持数组顺序（批量操作与范围计算依赖展示顺序）。
 */

interface SelectionState {
  active: boolean;
  selectedIds: number[];
  /** 范围选择锚点（shift 连选的起点）。 */
  anchorId: number | undefined;

  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  /** 点选/取消（cmd/ctrl 追加语义由调用方决定；此处为切换）。 */
  toggle: (tabId: number) => void;
  /** shift 连选：按展示顺序选中 anchor 到目标之间的全部。 */
  selectRange: (tabId: number, orderedTabIds: readonly number[]) => void;
  /** 全选当前列表。 */
  selectAll: (orderedTabIds: readonly number[]) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  active: false,
  selectedIds: [],
  anchorId: undefined,

  enterSelectionMode: () => set({ active: true }),
  exitSelectionMode: () => set({ active: false, selectedIds: [], anchorId: undefined }),
  toggle: (tabId) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(tabId)
        ? state.selectedIds.filter((id) => id !== tabId)
        : [...state.selectedIds, tabId],
      anchorId: state.anchorId ?? tabId
    })),
  selectRange: (tabId, orderedTabIds) => {
    const anchorId = get().anchorId;
    if (anchorId === undefined) {
      get().toggle(tabId);
      return;
    }
    const anchorIndex = orderedTabIds.indexOf(anchorId);
    const targetIndex = orderedTabIds.indexOf(tabId);
    if (anchorIndex < 0 || targetIndex < 0) {
      get().toggle(tabId);
      return;
    }
    const [start, end] = anchorIndex < targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    const range = orderedTabIds.slice(start, end + 1);
    // 范围语义：合并入选中集（不取消其他）
    set((state) => {
      const merged = new Set([...state.selectedIds, ...range]);
      return { selectedIds: [...merged], anchorId: state.anchorId ?? tabId };
    });
  },
  selectAll: (orderedTabIds) => set({ selectedIds: [...orderedTabIds], anchorId: undefined }),
  clear: () => set({ selectedIds: [], anchorId: undefined })
}));
