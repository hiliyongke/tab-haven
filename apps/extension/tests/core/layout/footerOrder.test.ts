import { describe, expect, it } from 'vitest';
import {
  FOOTER_BUTTON_IDS,
  FOOTER_BUTTON_KEYS,
  FOOTER_ID_PREFIX,
  footerButtonId,
  footerButtonKeyFromId
} from '@/core/layout/footerOrder';

describe('footerButtonId', () => {
  it('为每个按钮生成带有 footer: 前缀的拖拽 id', () => {
    const ids = FOOTER_BUTTON_KEYS.map(footerButtonId);

    expect(ids).toEqual(FOOTER_BUTTON_IDS);
    expect(ids.every((id) => id.startsWith(FOOTER_ID_PREFIX))).toBe(true);
  });
});

describe('footerButtonKeyFromId', () => {
  it('将拖拽 id 映射回对应按钮 key', () => {
    for (const key of FOOTER_BUTTON_KEYS) {
      expect(footerButtonKeyFromId(footerButtonId(key))).toBe(key);
    }
  });
});
