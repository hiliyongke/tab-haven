import { describe, expect, it } from 'vitest';
import { SNAPSHOTS_LIMIT, SNAPSHOT_TABS_LIMIT, SnapshotSchema } from '@/core/schema/models';
import { parseWorkona, WORKONA_INPUT_LIMIT } from '@/core/insights/workonaImport';
import { DEFAULT_SNAPSHOT_NAMES } from '@/core/snapshot/defaultNames';

/** 真实 Workona 导出结构的精简样本（字段名大小写与官方导出一致）。 */
const SAMPLE = JSON.stringify({
  Workspaces: [
    {
      title: 'Projects',
      workspaces: [
        {
          title: 'Project Alpha',
          tabs: [
            { title: 'GitHub - Alpha Repo', url: 'https://github.com/org/alpha' },
            { title: 'Staging', url: 'https://alpha.staging.example.com' }
          ]
        },
        {
          title: 'Empty Workspace',
          tabs: [{ title: 'Internal page', url: 'chrome://settings' }]
        }
      ]
    },
    {
      title: 'Research',
      workspaces: [
        {
          title: 'Reading list',
          tabs: [{ title: 'Docs', url: 'https://docs.example.com/guide' }],
          resources: [
            {
              title: 'References',
              resources: [{ title: 'Spec', url: 'https://spec.example.com/v2' }]
            }
          ]
        }
      ]
    }
  ],
  'Archived Workspaces': [
    {
      title: 'Old Project',
      tabs: [{ title: 'Legacy wiki', url: 'https://wiki.example.com/old' }]
    }
  ]
});

describe('parseWorkona', () => {
  let seq = 0;
  const fixedId = (): string => {
    seq += 1;
    return `snap-${seq}`;
  };

  it('每个带可恢复标签的 workspace 转一份快照，resources 并入', () => {
    seq = 0;
    const result = parseWorkona(SAMPLE, fixedId, 123);
    // Alpha(2) + Reading list(tabs 1 + resources 1 = 2) + Old Project(1) = 3 份
    expect(result.snapshots).toHaveLength(3);
    expect(result.totalTabs).toBe(5);
    // Empty Workspace 识别了但无可恢复条目 → skipped
    expect(result.skippedWorkspaces).toBe(1);
    const names = result.snapshots.map((snap) => snap.name);
    expect(names).toEqual(['Project Alpha', 'Reading list', 'Old Project']);
  });

  it('归档 workspace 的 origin 为 archive，其余为 manual', () => {
    seq = 0;
    const result = parseWorkona(SAMPLE, fixedId, 123);
    expect(result.snapshots.map((snap) => snap.origin)).toEqual(['manual', 'manual', 'archive']);
  });

  it('resources 条目并入同一份快照且保留标题', () => {
    seq = 0;
    const result = parseWorkona(SAMPLE, fixedId, 123);
    const reading = result.snapshots.find((snap) => snap.name === 'Reading list');
    expect(reading?.tabs.map((tab) => tab.url)).toEqual([
      'https://docs.example.com/guide',
      'https://spec.example.com/v2'
    ]);
    expect(reading?.tabs[1]?.title).toBe('Spec');
  });

  it('产出的快照通过 SnapshotSchema 校验（tabCount 一致性含在 refine 内）', () => {
    seq = 0;
    const result = parseWorkona(SAMPLE, fixedId, 123);
    for (const snapshot of result.snapshots) {
      expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
    }
  });

  it('无标题 workspace 回退默认名；注入 id 与时间透传', () => {
    const raw = JSON.stringify({
      Workspaces: [{ workspaces: [{ tabs: [{ url: 'https://a.com' }] }] }]
    });
    const result = parseWorkona(raw, () => 'fixed-id', 42);
    expect(result.snapshots[0]?.id).toBe('fixed-id');
    // 落盘默认名走 DEFAULT_SNAPSHOT_NAMES 常量（与 OneTab 侧同口径），
    // 不按界面语言生成 —— 换语言不该产出两套名字。
    expect(result.snapshots[0]?.name).toBe(DEFAULT_SNAPSHOT_NAMES.workona);
    expect(result.snapshots[0]?.name).toBe('Workona 导入');
    expect(result.snapshots[0]?.createdAt).toBe(42);
  });

  it('非 JSON / 非对象 / 空输入一律返回空结果不抛错', () => {
    expect(parseWorkona('not json', fixedId).snapshots).toHaveLength(0);
    expect(parseWorkona('"string"', fixedId).snapshots).toHaveLength(0);
    expect(parseWorkona('[1,2,3]', fixedId).snapshots).toHaveLength(0);
    expect(parseWorkona('{}', fixedId).snapshots).toHaveLength(0);
    expect(parseWorkona('', fixedId).snapshots).toHaveLength(0);
  });

  /**
   * 失败必须可解释（与备份导入 version-mismatch / invalid 分流同口径）：
   * 「文件太大」「不是 JSON」「JSON 不是 Workona 导出」三种失败若共用同一个
   * 空结果，用户只看到「导入 0 条」，无法判断下一步该做什么。
   */
  it('体积超限 → reason=too-large（可提示拆分成批导入）', () => {
    const huge = ' '.repeat(WORKONA_INPUT_LIMIT + 1);
    expect(parseWorkona(huge, fixedId).reason).toBe('too-large');
  });

  it('JSON 解析失败 → reason=invalid-json（可提示重新导出）', () => {
    expect(parseWorkona('{ not json', fixedId).reason).toBe('invalid-json');
  });

  it('合法 JSON 但不是对象结构 → reason=unrecognized', () => {
    // 顶层是数组 / 标量时根本不可能是 Workona 导出（其顶层是对象）。
    expect(parseWorkona('[1,2,3]', fixedId).reason).toBe('unrecognized');
    expect(parseWorkona('"string"', fixedId).reason).toBe('unrecognized');
  });

  it('结构合法但无 workspace → reason=ok（不是失败，只是没有可导入内容）', () => {
    expect(parseWorkona('{}', fixedId).reason).toBe('ok');
    // 顶层键一律 .passthrough()：多余字段原样忽略，不是格式错误。
    expect(parseWorkona('{"foo":1}', fixedId).reason).toBe('ok');
  });

  it('丢弃的量如实计入结果，不静默截断', () => {
    const raw = JSON.stringify({
      archived_workspaces: [
        {
          title: 'Mixed',
          tabs: [{ url: 'https://a.com' }, { url: 'chrome://settings' }, { url: 'not-a-url' }, {}]
        }
      ]
    });
    const result = parseWorkona(raw, fixedId);

    expect(result.totalTabs).toBe(1);
    // 3 条被丢弃：内部页 / 非 URL / 空条目 —— 只静默 return 时用户无从知道少了多少。
    expect(result.truncatedTabs).toBe(3);
  });

  it('超出单份快照标签上限的部分计入 truncatedTabs', () => {
    const tabs = Array.from({ length: SNAPSHOT_TABS_LIMIT + 5 }, (_v, i) => ({
      url: `https://a.com/${i}`
    }));
    const result = parseWorkona(JSON.stringify({ archived_workspaces: [{ tabs }] }), fixedId);

    expect(result.snapshots[0]?.tabs).toHaveLength(SNAPSHOT_TABS_LIMIT);
    expect(result.truncatedTabs).toBe(5);
  });

  it('超出快照族上限的份数计入 truncatedSnapshots（与备份导入同上限）', () => {
    const workspaces = Array.from({ length: SNAPSHOTS_LIMIT + 3 }, (_v, i) => ({
      title: `ws-${i}`,
      tabs: [{ url: `https://a.com/${i}` }]
    }));
    const result = parseWorkona(JSON.stringify({ archived_workspaces: workspaces }), fixedId);

    expect(result.snapshots).toHaveLength(SNAPSHOTS_LIMIT);
    expect(result.truncatedSnapshots).toBe(3);
    // totalTabs 必须等于**落盘份**的标签总数：在解析阶段累加会把被截断的 3 份
    // 也算进来（203），UI 报的导入条数就会大于实际落盘数。
    expect(result.totalTabs).toBe(SNAPSHOTS_LIMIT);
  });

  it('archived_workspaces 字段名变体（小写）同样识别', () => {
    const raw = JSON.stringify({
      archived_workspaces: [{ title: 'Legacy', tabs: [{ url: 'https://old.com' }] }]
    });
    const result = parseWorkona(raw, fixedId);
    expect(result.snapshots[0]?.origin).toBe('archive');
  });
});
