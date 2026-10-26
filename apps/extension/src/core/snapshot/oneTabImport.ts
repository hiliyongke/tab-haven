import { SNAPSHOT_TABS_LIMIT, type SnapshotTab } from '@/core/schema/models';

/** OneTab 导入文本的体积上限（1MB，远超正常使用规模）。 */
const ONE_TAB_INPUT_LIMIT = 1024 * 1024;

/**
 * 解析 OneTab 导出文本为快照条目。
 * 兼容格式：每行一个条目，可为裸 URL、或 "URL - Title"、"[URL] Title"。
 * 仅抽取可恢复的 URL；非法行跳过。返回轻量 SnapshotTab 数组。
 */
export function parseOneTab(text: string): SnapshotTab[] {
  const out: SnapshotTab[] = [];
  // 输入体积与输出条数都要设上限：粘贴内容是用户可控输入，
  // 超大文本会先构造出巨大数组，超条数则只在写盘时才被 schema 拒绝 ——
  // 用户只会看到一个泛化的「操作失败」。提前截断并给出确定性结果。
  if (text.length > ONE_TAB_INPUT_LIMIT) return out;
  for (const raw of text.split(/\r?\n/)) {
    if (out.length >= SNAPSHOT_TABS_LIMIT) break;
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    let url: string;
    let title = '';
    const bracket = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (bracket) {
      url = bracket[1]!.trim();
      title = bracket[2]?.trim() ?? '';
    } else if (line.includes(' - ')) {
      const separatorIndex = line.indexOf(' - ');
      url = line.slice(0, separatorIndex).trim();
      title = line.slice(separatorIndex + 3).trim();
    } else {
      url = line;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        out.push({ url: parsed.href, title, pinned: false, muted: false });
      }
    } catch {
      // 跳过非 URL 行
    }
  }
  return out;
}
