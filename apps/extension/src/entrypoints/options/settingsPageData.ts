import type { Translate } from '@/i18n';
import type { Settings } from '@/core/schema/models';
import { ImportDataError } from '@/stores/data/transferSlice';
import type { OutlineItem } from '@/ui/settings/SettingsOutline';
import type { SettingSpec } from '@/entrypoints/options/settingSections';

/**
 * 设置页编排层的数据与纯函数：导入分区取名、搜索匹配、目录与可见分区派生、失败提示。
 * 组件只负责状态、写盘通道与弹窗流转，纯判定集中在此便于校验。
 */

/** 导入文件体积上限（5MB）：备份为纯 JSON，此上限已远超正常使用规模。 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** 导入事务的分区名 → 界面称呼。值存待翻译原文，由 partitionLabel 在提示那一刻 t() 翻译（直接写 t() 会在模块加载期语言未定时求值）。 */
const PARTITION_LABELS: Record<string, { labelKey: string }> = {
  folders: { labelKey: '收藏夹' },
  pins: { labelKey: '常驻磁贴' },
  settings: { labelKey: '设置' },
  snapshots: { labelKey: '快照' },
  siteCollapse: { labelKey: '折叠状态' }
};

/** 取分区的界面称呼；未知分区原样返回（不丢信息）。 */
export function partitionLabel(name: string, t: (key: string) => string): string {
  const label = PARTITION_LABELS[name];
  return label === undefined ? name : t(label.labelKey);
}

interface SettingSection {
  id: string;
  titleKey: string;
  specs: SettingSpec[];
}

export interface VisibleSection {
  section: SettingSection;
  specs: SettingSpec[];
}

/** 设置项是否命中搜索（标题 / 说明 / 原文 / 下拉选项文案）。 */
export function matchesSettingSpec(
  spec: SettingSpec,
  q: string,
  t: (key: string) => string
): boolean {
  if (!q) return true;
  const label = t(spec.labelKey).toLowerCase();
  const hint = spec.hintKey ? t(spec.hintKey).toLowerCase() : '';
  if (label.includes(q) || hint.includes(q) || spec.labelKey.toLowerCase().includes(q)) {
    return true;
  }
  // 下拉选项文案也要参与匹配：像「最近访问」这样只存在于 select options 里的
  // 文案匹配不到时，用户会误判为「没有这个设置」。
  if (spec.kind === 'select') {
    return spec.options.some((option) => t(option.label).toLowerCase().includes(q));
  }
  return false;
}

/** 过滤后的分区（visible 判定 + 搜索命中）；目录与正文渲染共用同一份结果。 */
export function collectVisibleSections(
  sections: SettingSection[],
  settings: Settings,
  settingsSearch: string,
  t: (key: string) => string
): VisibleSection[] {
  const q = settingsSearch.trim().toLowerCase();
  const matchesSearch = (spec: SettingSpec): boolean => matchesSettingSpec(spec, q, t);
  return sections.map((section) => {
    // 分区标题也参与匹配：搜「分组」应当带回「分组与搜索」整个分区，
    // 而不只是命中标题里带这两个字的两三个设置项。
    // 只在有查询词时判定：`!q` 会让下面的三元恒真、分区命中分支永远走不到。
    const sectionHit = q.length > 0 && t(section.titleKey).toLowerCase().includes(q);
    return {
      section,
      specs: section.specs
        .filter((spec) => ('visible' in spec && spec.visible ? spec.visible(settings) : true))
        // 分区命中即整区保留；否则逐项匹配（无查询词时 matchesSearch 恒 true）。
        .filter((spec) => (sectionHit ? true : matchesSearch(spec)))
    };
  });
}

/** 静态区块的唯一可见集合：目录、正文与空态共用，禁止各自按不同口径过滤。 */
export function buildStaticOutlineItems(t: (key: string) => string, q: string): OutlineItem[] {
  return [
    { id: 'presets.title', label: t('快速预设') },
    { id: 'settings.capabilitiesGuide', label: t('你能做什么') },
    { id: 'fixedMap.title', label: t('固定概念一览') },
    { id: 'settings.shortcuts', label: t('快捷键') },
    { id: 'settings.data', label: t('数据备份') },
    { id: 'about.title', label: t('关于 Tabs') }
  ].filter((item) => !q || item.label.toLowerCase().includes(q));
}

/** 目录条目：静态区块 + 当前可见的设置分区（被搜索过滤掉的分区不进目录，避免点了没反应）。 */
export function buildOutlineItems(
  visibleStaticItems: OutlineItem[],
  visibleSections: VisibleSection[],
  t: (key: string) => string
): OutlineItem[] {
  // 锚点用 section.id（稳定标识），文案用 titleKey——两者不可混用
  const dynamic: OutlineItem[] = visibleSections
    .filter((entry) => entry.specs.length > 0)
    .map(({ section }) => ({ id: section.id, label: t(section.titleKey) }));
  return [...visibleStaticItems.slice(0, 3), ...dynamic, ...visibleStaticItems.slice(3)];
}

/** 导入失败提示：按错误口径给出可判定的下一步，结构化错误才敢宣称本地状态。 */
export function importFailureMessage(raw: string, error: unknown, t: Translate): string {
  let message = t('导入失败：备份文件无效或无法读取');
  if (raw === 'export-version-mismatch') {
    message = t('备份文件格式与当前版本不匹配，请选择当前版本导出的备份文件。');
  } else if (raw.startsWith('import-write-failed:')) {
    // 写盘失败带分区名；只有结构化错误明确给出空 rollbackFailures 时，
    // 才能宣称本地保持导入前。回滚失败或缺少结构信息都必须披露混合态风险。
    const name = partitionLabel(raw.slice('import-write-failed:'.length), t);
    if (error instanceof ImportDataError && error.rollbackFailures.length === 0) {
      message = t(
        '导入失败：写入「{{name}}」时存储不可用，已回滚（本地数据保持导入前的状态）。请确认浏览器存储空间后重试。',
        { name }
      );
    } else if (error instanceof ImportDataError) {
      message = t(
        '导入失败：写入「{{name}}」时存储不可用；回滚未完成的分区：{{partitions}}。本地数据可能处于混合状态，请勿重复导入。',
        {
          name,
          partitions: error.rollbackFailures
            .map((partition) => partitionLabel(partition, t))
            .join(', ')
        }
      );
    } else {
      message = t(
        '导入失败：写入「{{name}}」时存储不可用，且无法确认回滚是否完整。本地数据可能处于混合状态，请勿重复导入。',
        { name }
      );
    }
  }
  return message;
}
