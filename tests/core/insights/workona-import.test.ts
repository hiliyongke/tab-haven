import { describe, expect, it } from 'vitest';
import { SnapshotSchema } from '@/core/schema/models';
import {
  parseWorkona,
  WORKONA_INPUT_LIMIT,
  type WorkonaImportResult
} from '@/core/insights/workonaImport';

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

describe('parseWorkona（P-09 迁移器）', () => {
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
    expect(result.snapshots[0]?.name).toBe('Workona import');
    expect(result.snapshots[0]?.createdAt).toBe(42);
  });

  it('非 JSON / 非对象 / 空输入一律返回空结果不抛错', () => {
    expect(parseWorkona('not json', fixedId).snapshots).toHaveLength(0);
    expect(parseWorkona('"string"', fixedId).snapshots).toHaveLength(0);
    expect(parseWorkona('[1,2,3]', fixedId).snapshots).toHaveLength(0);
    expect(parseWorkona('{}', fixedId).snapshots).toHaveLength(0);
    expect(parseWorkona('', fixedId).snapshots).toHaveLength(0);
  });

  it('超过 1MB 输入直接拒收（与 parseOneTab 同口径）', () => {
    const huge = ' '.repeat(WORKONA_INPUT_LIMIT + 1);
    const result: WorkonaImportResult = parseWorkona(huge, fixedId);
    expect(result.snapshots).toHaveLength(0);
  });

  it('archived_workspaces 字段名变体（小写）同样识别', () => {
    const raw = JSON.stringify({
      archived_workspaces: [{ title: 'Legacy', tabs: [{ url: 'https://old.com' }] }]
    });
    const result = parseWorkona(raw, fixedId);
    expect(result.snapshots[0]?.origin).toBe('archive');
  });
});
