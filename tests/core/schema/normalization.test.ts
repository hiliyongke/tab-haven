import { describe, expect, it } from 'vitest';
import {
  PersistentPinSchema,
  SettingsSchema,
  SiteCollapseSchema,
  SnapshotTabSchema,
  parseExportFile
} from '@/core/schema/models';

/**
 * 行为规格：归一化口径唯一在 schema 层。
 *
 * 「只在 UI 输入处归一化」在这里是明确的事故模式：备份导入、同步镜像、直接写
 * storage 三条路径都不经过 UI，落盘即为未归一化值；而匹配端再归一化一次时结果
 * 未必与 UI 一致 —— 表现为「明明加进了白名单，还是被休眠了」「同站点磁贴重复留存」。
 */

describe('休眠白名单归一化', () => {
  it('Given 用户粘贴整串 URL When 经 Settings 校验 Then 归一为纯 hostname', () => {
    const parsed = SettingsSchema.parse({
      discardWhitelist: ['HTTPS://WWW.Example.com/some/path', '  mail.qq.com  ']
    });

    expect(parsed.discardWhitelist).toEqual(['example.com', 'mail.qq.com']);
  });

  it('Given 归一化后为空的条目 When 经 Settings 校验 Then 丢弃（不留下空串匹配项）', () => {
    const parsed = SettingsSchema.parse({ discardWhitelist: ['https://', '   ', 'a.com'] });

    expect(parsed.discardWhitelist).toEqual(['a.com']);
  });
});

describe('常驻磁贴 identity 归一化', () => {
  it('Given 大小写与 www 前缀不一致的 identity When 校验 Then 归一（dedupePins 才能判重）', () => {
    const pin = PersistentPinSchema.parse({
      id: 'p1',
      identity: 'WWW.Example.COM',
      url: 'https://www.example.com/',
      title: 'Example'
    });

    expect(pin.identity).toBe('example.com');
  });

  it('Given 带端口的 identity When 校验 Then 保留端口（与 pinIdentity 同口径）', () => {
    const pin = PersistentPinSchema.parse({
      id: 'p1',
      identity: 'WWW.localhost:3000',
      url: 'http://localhost:3000/',
      title: 'Dev'
    });

    expect(pin.identity).toBe('localhost:3000');
  });
});

describe('折叠站点记录归一化', () => {
  it('Given 尾点与 www 前缀不一致的记录 When 校验 Then 归一（否则折叠态永不命中）', () => {
    const parsed = SiteCollapseSchema.parse(['WWW.Example.com.', 'b.com']);

    expect(parsed).toEqual(['example.com', 'b.com']);
  });

  it('Given 归一化后重复的站点 When 校验 Then 去重（同一站点只占一份额度）', () => {
    const parsed = SiteCollapseSchema.parse(['WWW.a.com', 'a.com.', 'a.com', 'b.com']);

    expect(parsed).toEqual(['a.com', 'b.com']);
  });
});

/**
 * 上限必须在归一化**之后**生效。
 *
 * 写在 transform 之前时，`WWW.a.com` 与 `a.com.` 会各占一份额度（归一化后是同一
 * 站点），上限因此比实际可折叠的站点数更早触顶；数组内还会残留重复项，放大折叠
 * 比对与遍历成本。
 */
describe('去重与上限的后置语义', () => {
  it('Given 归一化后重复的条目 When 校验 Then 先去重再判上限（上限不被重复项吃掉）', () => {
    const repeated = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'WWW.a.com' : 'A.com.'));
    const parsed = SiteCollapseSchema.parse(repeated);

    expect(parsed).toEqual(['a.com']);
  });

  it('Given 超过上限的不同站点 When 校验 Then 拒绝（上限仍生效）', () => {
    const many = Array.from({ length: 2001 }, (_, i) => `s${i}.com`);
    const parsed = SiteCollapseSchema.safeParse(many);

    expect(parsed.success).toBe(false);
  });

  it('Given 白名单里归一化后重复的条目 When 校验 Then 去重后保留一条', () => {
    const parsed = SettingsSchema.parse({
      discardWhitelist: ['WWW.a.com', 'a.com.', 'https://a.com/x', 'b.com']
    });

    expect(parsed.discardWhitelist).toEqual(['a.com', 'b.com']);
  });
});

describe('快照组色收严', () => {
  it('Given 浏览器合法色名 When 校验 Then 原样通过', () => {
    const tab = SnapshotTabSchema.parse({ url: 'https://a.com', groupColor: 'cyan' });

    expect(tab.groupColor).toBe('cyan');
  });

  it('Given 非法色名 When 校验 Then 降级为缺省（不让一条装饰数据判死整份备份）', () => {
    // 组色只用于重建组时取色：整条 SnapshotTab 校验失败会让 snapshots 数组失败，
    // 进而整份备份被拒 —— 与 favIconUrl / url 的「归一化而非判坏」必须是同口径。
    const tab = SnapshotTabSchema.parse({ url: 'https://a.com', groupColor: 'chartreuse' });

    expect(tab.groupColor).toBeUndefined();
  });
});

describe('备份导入的坏组色隔离', () => {
  it('Given 备份里单条组色非法 When 导入 Then 该条降级、其余快照完整导入', () => {
    const parsed = parseExportFile({
      format: 'tabs.export',
      version: 1,
      exportedAt: new Date().toISOString(),
      fixedFolders: [],
      persistentPins: [],
      siteCollapse: [],
      settings: {},
      snapshots: [
        {
          id: 's1',
          name: 'Bad color',
          origin: 'manual',
          createdAt: 1,
          tabCount: 1,
          tabs: [{ url: 'https://a.com', groupColor: 'banana' }]
        },
        {
          id: 's2',
          name: 'Good',
          origin: 'manual',
          createdAt: 2,
          tabCount: 1,
          tabs: [{ url: 'https://b.com', groupColor: 'cyan' }]
        }
      ]
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.snapshots).toHaveLength(2);
    expect(parsed.data.snapshots[0]?.tabs[0]?.groupColor).toBeUndefined();
    expect(parsed.data.snapshots[1]?.tabs[0]?.groupColor).toBe('cyan');
  });
});

describe('备份导入的归一化', () => {
  it('Given 备份里 identity 与 url 不一致 When 导入 Then 按 url 重算 identity', () => {
    const parsed = parseExportFile({
      format: 'tabs.export',
      version: 1,
      exportedAt: new Date().toISOString(),
      fixedFolders: [],
      persistentPins: [
        {
          id: 'p1',
          // 备份里的 identity 是外部数据：若与 url 不一致，dedupePins 会按这个
          // 失真身份判重，产出点开是新标签页的磁贴。
          identity: 'WWW.Example.COM',
          url: 'https://www.example.com/',
          title: 'Example'
        }
      ],
      siteCollapse: [],
      settings: {}
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.persistentPins[0]?.identity).toBe('example.com');
  });

  it('Given 备份里 url 被降级为占位 When 导入 Then 保留原 identity（不塌缩成空串）', () => {
    const parsed = parseExportFile({
      format: 'tabs.export',
      version: 1,
      exportedAt: new Date().toISOString(),
      fixedFolders: [],
      persistentPins: [
        { id: 'p1', identity: 'example.com', url: 'javascript:alert(1)', title: 'Bad' }
      ],
      siteCollapse: [],
      settings: {}
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.persistentPins[0]?.url).toBe('about:blank');
    expect(parsed.data.persistentPins[0]?.identity).toBe('example.com');
  });

  it('Given 备份里的白名单未归一化 When 导入 Then 落盘前已归一', () => {
    const parsed = parseExportFile({
      format: 'tabs.export',
      version: 1,
      exportedAt: new Date().toISOString(),
      fixedFolders: [],
      persistentPins: [],
      siteCollapse: ['WWW.A.com.'],
      settings: { discardWhitelist: ['HTTPS://WWW.Example.com/path'] }
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.settings.discardWhitelist).toEqual(['example.com']);
    expect(parsed.data.siteCollapse).toEqual(['a.com']);
  });
});
