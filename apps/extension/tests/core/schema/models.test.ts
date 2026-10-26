import { describe, expect, it } from 'vitest';
import {
  AutoDiscardBatchSchema,
  DEFAULT_SETTINGS,
  InboundFixedFolderSchema,
  InboundPersistentPinSchema,
  SettingsSchema,
  UndoBatchSchema
} from '@/core/schema/models';
import { FOOTER_BUTTON_KEYS } from '@/core/layout/footerOrder';

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
  });

  it('language 宽松校验：缺省 undefined，合法 BCP-47 通过', () => {
    expect(SettingsSchema.parse({}).language).toBeUndefined();
    expect(SettingsSchema.parse({ language: 'zh-CN' }).language).toBe('zh-CN');
    expect(SettingsSchema.safeParse({ language: 'x' }).success).toBe(false);
  });

  it('未知键（非本版本字段）被剥离而非报错', () => {
    // Tabs未发布过正式版，不存在需要兼容的旧字段；这里守的是 zod 的通用行为：
    // 存储里出现任何当前 schema 未声明的键时解析仍成功并剥离该键，
    // 避免脏写入让整块设置被 DataRepository 判为坏数据而回退默认值。
    const withUnknownKey = { ...DEFAULT_SETTINGS, notAFieldOfThisVersion: false };
    const parsed = SettingsSchema.safeParse(withUnknownKey);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('notAFieldOfThisVersion' in parsed.data).toBe(false);
      expect(parsed.data.themePreference).toBe(DEFAULT_SETTINGS.themePreference);
      expect(parsed.data.noCachePatterns).toEqual(DEFAULT_SETTINGS.noCachePatterns);
    }
  });
});

/**
 * 底栏顺序：外部输入（备份 / 同步镜像 / 直接写 storage）都不经过设置页，
 * 归一与长度上限必须落在 schema 层 —— 否则落盘的就是任意长的原始数组。
 */
describe('SettingsSchema.footerOrder', () => {
  it('未知 id 被过滤、重复项去重、缺失按钮按默认顺序补齐', () => {
    const parsed = SettingsSchema.parse({
      footerOrder: ['footer:bogus', 'footer:palette', 'footer:palette']
    });
    expect(parsed.footerOrder[0]).toBe('footer:palette');
    expect(parsed.footerOrder).toHaveLength(FOOTER_BUTTON_KEYS.length);
    // 补齐后是完整且不重复的按钮 id 集合
    expect(new Set(parsed.footerOrder).size).toBe(FOOTER_BUTTON_KEYS.length);
    for (const key of FOOTER_BUTTON_KEYS) {
      expect(parsed.footerOrder).toContain(`footer:${key}`);
    }
  });

  it('空数组 = 默认顺序（与用户从未拖拽过时一致）', () => {
    expect(SettingsSchema.parse({ footerOrder: [] }).footerOrder).toEqual(
      FOOTER_BUTTON_KEYS.map((key) => `footer:${key}`)
    );
  });

  it('注入的超长数组不会原样落盘（收敛到按钮数上限）', () => {
    // 备份可构造任意长数组；落盘侧按「过滤而非拒绝」处理（旧版本残留 id 不该
    // 让整份设置解析失败），但结果恒不超过按钮总数。
    const huge = Array.from({ length: 500 }, () => 'footer:palette');
    const parsed = SettingsSchema.parse({ footerOrder: huge });
    expect(parsed.footerOrder).toHaveLength(FOOTER_BUTTON_KEYS.length);
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
