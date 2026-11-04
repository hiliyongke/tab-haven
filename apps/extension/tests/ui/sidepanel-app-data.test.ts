import { describe, expect, it } from 'vitest';
import {
  INIT_RETRY_DELAY_MS,
  INIT_MAX_ATTEMPTS,
  TOUR_AUTO_OPEN_DELAY_MS,
  countInsights
} from '@/entrypoints/sidepanel/appData';

describe('侧边栏数据与纯函数', () => {
  it('Given 无可休眠标签，When 统计洞察条数，Then 只累加重复重灾区与滞留标签', () => {
    expect(countInsights({ duplicateHotspots: [1, 2], discardableCount: 0, staleTabs: [1] })).toBe(
      3
    );
  });

  it('Given 存在可休眠标签，When 统计洞察条数，Then 额外计入一项', () => {
    expect(countInsights({ duplicateHotspots: [1, 2], discardableCount: 4, staleTabs: [1] })).toBe(
      4
    );
  });

  it('Given 面板时机常量，When 读取，Then 与重试与引导延迟约定一致', () => {
    expect(INIT_RETRY_DELAY_MS).toBe(1000);
    expect(INIT_MAX_ATTEMPTS).toBe(2);
    expect(TOUR_AUTO_OPEN_DELAY_MS).toBe(900);
  });
});
