import { create } from 'zustand';

/** 界面态 store 占位（架构文档 5.5 的 uiStore 最小骨架）。 */
interface UiState {
  theme: 'system' | 'light' | 'dark';
  setTheme: (theme: UiState['theme']) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  theme: 'system',
  setTheme: (theme) => set({ theme })
}));
