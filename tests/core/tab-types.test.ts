import { describe, expect, it } from 'vitest';
import { canSafelyDiscardTab } from '@/core/tab-types';

const safeTab = {
  active: false,
  pinned: false,
  discarded: false,
  audible: false,
  attention: false,
  status: 'complete',
  autoDiscardable: true
};

describe('canSafelyDiscardTab', () => {
  it('requires a browser-provided lastAccessed timestamp', () => {
    expect(canSafelyDiscardTab(safeTab)).toBe(false);
    expect(canSafelyDiscardTab({ ...safeTab, lastAccessed: Date.now() })).toBe(true);
  });

  it('rejects protected tabs', () => {
    expect(canSafelyDiscardTab({ ...safeTab, lastAccessed: Date.now(), active: true })).toBe(false);
    expect(canSafelyDiscardTab({ ...safeTab, lastAccessed: Date.now(), audible: true })).toBe(false);
    expect(canSafelyDiscardTab({ ...safeTab, lastAccessed: Date.now(), autoDiscardable: false })).toBe(false);
  });
});
