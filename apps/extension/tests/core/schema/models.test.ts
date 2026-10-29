import { describe, expect, it } from 'vitest';
import {
  AutoDiscardBatchSchema,
  DEFAULT_SETTINGS,
  InboundFixedFolderSchema,
  InboundPersistentPinSchema,
  SettingsSchema,
  UndoBatchSchema
} from '@/core/schema/models';
import { FOOTER_BUTTON_IDS, FOOTER_BUTTON_KEYS, footerButtonId } from '@/core/layout/footerOrder';

/**
 * schema 层行为规格：
 *  - SettingsSchema.parse({}) 必须与 DEFAULT_SETTINGS 一致（默认值单一事实源）；
 *  - 非法数据必须被拒绝（safeParse 失败路径有消费方：仓库层隔离坏数据）；
 *  - AutoDiscardBatch 的 count 冗余字段必须与 tabIds.length 一致。
 */
describe('SettingsSchema', () => {
  it('空对象解析成功（任一字段漏写 .default() 即在此崩溃性失败）', () => {
    expect(SettingsSchema.safeParse({}).success).toBe(true);
  });

  it('空对象解析结果与 DEFAULT_SETTINGS 完全一致', () => {
    expect(SettingsSchema.parse({})).toEqual(DEFAULT_SETTINGS);
  });

  it('默认设置键集与空对象解析结果完全一致（未遗漏/多余的字段）', () => {
    // 与 parse({}) 的键集比对：新增字段时两侧自动同步、测试自适应，不写死计数。
    // 注意：可选且无输入的字段（如 language）解析后值恒为 undefined，zod 会将其从
    // Object.keys 中剔除，故基准取「解析结果自身的键」而非 schema.shape（后者含 language）。
    const parsed = SettingsSchema.parse({});
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(Object.keys(parsed).sort());
  });

  it('默认设置包含全部关键字段，且字段数符合预期规模', () => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    // 关键字段必须存在（覆盖外观 / 同步开关 / 缓存 / 自动休眠等分组）。
    for (const key of [
      'themePreference',
      'syncMirrorEnabled',
      'noCachePatterns',
      'discardWhitelist',
      'autoSaveSnapshots',
      'onboarded',
      'conceptsSeen'
    ]) {
      expect(keys).toContain(key);
    }
    // 规模守护：新增设置项时此下限自然满足，防止 schema 被整体清空导致 DEFAULT_SETTINGS 塌缩。
    expect(keys.length).toBeGreaterThanOrEqual(40);
  });

  it('部分字段缺失时补默认值，已存字段保留', () => {
    const parsed = SettingsSchema.parse({ themePreference: 'dark', showUrl: true });
    expect(parsed.themePreference).toBe('dark');
    expect(parsed.showUrl).toBe(true);
    expect(parsed.aggregationThreshold).toBe(2);
    expect(parsed.tabOrderSync).toBe(true);
  });

  it('非法值被拒绝（safeParse 失败路径）', () => {
    expect(SettingsSchema.safeParse({ themePreference: 'neon' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ aggregationThreshold: 0 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ aggregationThreshold: 6 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ toastDurationSec: 0 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ density: 'ultra' }).success).toBe(false);
  });

  it('列表密度四档全部合法，默认仍是 cozy', () => {
    // UI 侧（RowItem / 骨架屏 / SectionList）共用 Density 类型；
    // 这里守住「档位集合」本身，加档/删档必须同步 UI 与 CSS。
    for (const density of ['tight', 'compact', 'cozy', 'large'] as const) {
      expect(SettingsSchema.parse({ density }).density).toBe(density);
    }
    expect(SettingsSchema.parse({}).density).toBe('cozy');
  });

  it('language 宽松校验：缺省 undefined，合法 BCP-47 通过', () => {
    expect(SettingsSchema.parse({}).language).toBeUndefined();
    expect(SettingsSchema.parse({ language: 'zh-CN' }).language).toBe('zh-CN');
    expect(SettingsSchema.safeParse({ language: 'x' }).success).toBe(false);
  });

  it('未声明的设置字段被拒绝', () => {
    const withUnknownKey = { ...DEFAULT_SETTINGS, unexpectedField: false };

    expect(SettingsSchema.safeParse(withUnknownKey).success).toBe(false);
  });
});

describe('SettingsSchema.footerOrder', () => {
  const defaultOrder = FOOTER_BUTTON_KEYS.map(footerButtonId);

  it('缺少字段时采用完整默认顺序', () => {
    expect(SettingsSchema.parse({}).footerOrder).toEqual(FOOTER_BUTTON_IDS);
  });

  it('接受完整且不重复的自定义顺序', () => {
    const customOrder = [
      footerButtonId('settings'),
      footerButtonId('palette'),
      ...defaultOrder.filter((id) => id !== 'footer:settings' && id !== 'footer:palette')
    ];

    expect(SettingsSchema.parse({ footerOrder: customOrder }).footerOrder).toEqual(customOrder);
  });

  it('拒绝未知按钮 id', () => {
    const unknownId = defaultOrder.map((id, index) => (index === 0 ? 'footer:unknown' : id));

    expect(SettingsSchema.safeParse({ footerOrder: unknownId }).success).toBe(false);
  });

  it('拒绝缺少按钮、重复按钮和超长顺序', () => {
    const incompleteOrder = defaultOrder.slice(1);
    const duplicateOrder = defaultOrder.map((id, index) => (index === 0 ? defaultOrder[1] : id));
    const oversizedOrder = [...defaultOrder, defaultOrder[0]];

    expect(SettingsSchema.safeParse({ footerOrder: incompleteOrder }).success).toBe(false);
    expect(SettingsSchema.safeParse({ footerOrder: duplicateOrder }).success).toBe(false);
    expect(SettingsSchema.safeParse({ footerOrder: oversizedOrder }).success).toBe(false);
  });
});

/**
 * 外部输入专用 schema（备份导入 + 同步镜像共用）。
 *
 * 镜像与备份同级：都经浏览器账号通道 / 用户手里的文件进入本机，都不在信任
 * 边界内。两处共用 `Inbound*Schema`，避免「备份入口降级、镜像入口原样落盘」。
 */
describe('InboundFixedFolderSchema / InboundPersistentPinSchema', () => {
  it('非网页 scheme 的 url 一律降级为 about:blank（镜像与备份同口径）', () => {
    const folder = InboundFixedFolderSchema.parse({
      id: 'f1',
      name: 'F',
      collapsed: false,
      items: [
        { id: 'i1', url: 'javascript:alert(1)', title: 'x', createdAt: 1 },
        { id: 'i2', url: 'file:///etc/passwd', title: 'y', createdAt: 1 }
      ]
    });
    expect(folder.items.map((item) => item.url)).toEqual(['about:blank', 'about:blank']);

    const pin = InboundPersistentPinSchema.parse({
      id: 'p1',
      identity: 'example.com',
      url: 'javascript:alert(1)',
      title: 'x'
    });
    expect(pin.url).toBe('about:blank');
    // url 被降级时 pinIdentity 返回 null：保留原 identity（去重仍需它），
    // 不去写空串——空串会让全部降级磁贴塌缩成一个。
    expect(pin.identity).toBe('example.com');
  });

  it('任意 http(s) favicon 被丢弃，白名单 scheme 保留（图标不发外部请求）', () => {
    const folder = InboundFixedFolderSchema.parse({
      id: 'f1',
      name: 'F',
      collapsed: false,
      items: [
        {
          id: 'i1',
          url: 'https://a.com',
          title: 'x',
          favIconUrl: 'https://a.com/f.ico',
          createdAt: 1
        },
        {
          id: 'i2',
          url: 'https://b.com',
          title: 'y',
          favIconUrl: 'data:image/png;base64,AA',
          createdAt: 1
        }
      ]
    });
    expect(folder.items[0]?.favIconUrl).toBeUndefined();
    expect(folder.items[1]?.favIconUrl).toBe('data:image/png;base64,AA');

    const pin = InboundPersistentPinSchema.parse({
      id: 'p1',
      identity: 'a.com',
      url: 'https://a.com',
      title: 'x',
      favIconUrl: 'http://a.com/f.ico'
    });
    expect(pin.favIconUrl).toBeUndefined();
  });
});

/**
 * 撤销记录：恢复动作直接吃这些字段喂给浏览器 API，形状必须在 schema 层收住。
 * 小数 index / groupId 不会报错，只会让恢复以静默失败告终。
 */
describe('UndoBatchSchema', () => {
  const entry = { url: 'https://a.com', index: 0, pinned: false, muted: false, groupId: -1 };
  const batch = { id: 'b1', kind: 'restore', createdAt: 1, windowId: 3, entries: [entry] };

  it('合法批次通过', () => {
    expect(UndoBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('index / groupId 非整数被拒绝（浏览器 API 的位置与组 id）', () => {
    expect(
      UndoBatchSchema.safeParse({ ...batch, entries: [{ ...entry, index: 1.5 }] }).success
    ).toBe(false);
    expect(
      UndoBatchSchema.safeParse({ ...batch, entries: [{ ...entry, groupId: 1.5 }] }).success
    ).toBe(false);
  });

  it('kind 空串或超长被拒绝（备份可注入任意长字符串）', () => {
    expect(UndoBatchSchema.safeParse({ ...batch, kind: '' }).success).toBe(false);
    expect(UndoBatchSchema.safeParse({ ...batch, kind: 'x'.repeat(33) }).success).toBe(false);
    // 上限内仍可扩展（新类别不需要改 schema）
    expect(UndoBatchSchema.safeParse({ ...batch, kind: 'restore-tabs' }).success).toBe(true);
  });
});

describe('AutoDiscardBatchSchema', () => {
  it('count 与 tabIds.length 一致时通过', () => {
    expect(AutoDiscardBatchSchema.safeParse({ tabIds: [1, 2], at: 123, count: 2 }).success).toBe(
      true
    );
  });

  it('count 与 tabIds.length 不一致时拒绝（防脏数据）', () => {
    expect(AutoDiscardBatchSchema.safeParse({ tabIds: [1, 2], at: 123, count: 5 }).success).toBe(
      false
    );
  });
});
