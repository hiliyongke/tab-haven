import type {
  ExportFile,
  FixedFolder,
  PersistentPin,
  Settings,
  SiteCollapseState
} from '@/core/schema/models';
import { ExportFileSchema } from '@/core/schema/models';

/**
 * 导出服务（FR-D9.1）：全量 JSON（版本化）+ 纯 URL 列表双格式。
 * 导入复用同一版本管道（formatVersion 校验），保证往返无损。
 */

export interface ExportSource {
  folders: FixedFolder[];
  pins: PersistentPin[];
  collapsedSites: SiteCollapseState;
  settings: Settings;
}

export function buildExport(source: ExportSource): ExportFile {
  return {
    format: 'tabhaven.export',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    fixedFolders: source.folders,
    persistentPins: source.pins,
    siteCollapse: source.collapsedSites,
    settings: source.settings
  };
}

export function serializeExport(exportFile: ExportFile): string {
  return JSON.stringify(exportFile, null, 2);
}

/** 纯 URL 列表（人类可读，每行一个 URL；供任何工具消费）。 */
export function buildUrlList(source: ExportSource): string {
  const urls = new Set<string>();
  for (const pin of source.pins) {
    if (pin.url) urls.add(pin.url);
  }
  for (const folder of source.folders) {
    for (const item of folder.items) {
      if (item.url) urls.add(item.url);
    }
  }
  return [...urls].join('\n');
}

export type ImportResult =
  | { ok: true; data: ExportFile }
  | { ok: false; error: string };

/** 解析导入文本：格式/版本校验 + 数据校验。 */
export function parseImport(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' };
  }
  const parsed = ExportFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: '数据格式不受支持（版本不匹配或字段缺失）' };
  }
  return { ok: true, data: parsed.data };
}

/** 合并模式：固定条目与 pin 按身份/URL 去重并入。 */
export function mergeFolders(current: FixedFolder[], incoming: FixedFolder[]): FixedFolder[] {
  const seen = new Set<string>();
  for (const folder of current) {
    for (const item of folder.items) {
      if (item.url) seen.add(item.url);
    }
  }
  const result = [...current];
  for (const folder of incoming) {
    const items = folder.items.filter((item) => !item.url || !seen.has(item.url));
    if (items.length === 0) continue;
    for (const item of items) {
      if (item.url) seen.add(item.url);
    }
    result.push({ ...folder, items });
  }
  return result;
}

export function mergePins(current: PersistentPin[], incoming: PersistentPin[]): PersistentPin[] {
  const seen = new Set(current.map((pin) => pin.identity));
  const result = [...current];
  for (const pin of incoming) {
    if (seen.has(pin.identity)) continue;
    seen.add(pin.identity);
    result.push(pin);
  }
  return result;
}
