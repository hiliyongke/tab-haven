import { useTranslation } from '@/i18n';
import { Button } from '@/ui/common/Button';
import { SegmentedChip } from '@/ui/common/SegmentedChip';
import { TextField } from '@/ui/common/TextField';
import type { ImportSource } from '@/ui/snapshot/useSnapshotImport';
import { TextButton } from '@/ui/snapshot/snapshotButtons';

/**
 * 导入视图：OneTab 文本 / Workona JSON 两条迁移路径的表单。
 *
 * 从面板拆出的原因：它是纯表单（无快照读写），与「列表 + 周报 + 三个确认弹窗」
 * 混在一个 699 行组件里时，改一句导入说明要在三种视图的 JSX 之间翻找。
 */
export function SnapshotImportView({
  source,
  onSourceChange,
  name,
  onNameChange,
  text,
  onTextChange,
  onCancel,
  onImport
}: {
  source: ImportSource;
  onSourceChange: (source: ImportSource) => void;
  name: string;
  onNameChange: (value: string) => void;
  text: string;
  onTextChange: (value: string) => void;
  onCancel: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {/* 源切换：OneTab 文本 / Workona JSON（迁移矩阵入口，互斥单选）。
          用 role=group + aria-pressed 而非 role=tablist/tab：后者要求配套的
          tabpanel / aria-controls / 方向键漫游 / roving tabindex，这里只实现了一半，
          读屏被承诺「选项卡」却按不出对应行为（工作区切换条 SpaceStrip 同口径）。 */}
      <div
        role="group"
        aria-label={t('选择导入源')}
        className="flex gap-1 self-start rounded-lg border border-gray-200 bg-gray-50 p-0.5"
      >
        <SegmentedChip selected={source === 'onetab'} onSelect={() => onSourceChange('onetab')}>
          {t('从 OneTab 导入')}
        </SegmentedChip>
        <SegmentedChip selected={source === 'workona'} onSelect={() => onSourceChange('workona')}>
          {t('从 Workona 导入')}
        </SegmentedChip>
      </div>
      <p className="text-3xs text-gray-500">
        {source === 'onetab'
          ? t('把 OneTab 导出的文本粘贴到这里，我们会解析其中的网址并保存为一个快照')
          : t(
              '把 Workona 导出的 JSON 全文粘贴到这里：每个工作区会转换成一份快照（含归档工作区），仅导入 http/https 网址'
            )}
      </p>
      {source === 'onetab' && (
        <TextField
          size="sm"
          placeholder={t('为这个快照起个名字（可留空）')}
          ariaLabel={t('为这个快照起个名字（可留空）')}
          value={name}
          onChange={onNameChange}
        />
      )}
      <TextField
        multiline
        className="h-40"
        placeholder={
          source === 'onetab' ? t('https://example.com - 网页标题') : t('{ "Workspaces": [ … ] }')
        }
        ariaLabel={t('导入')}
        value={text}
        onChange={onTextChange}
      />
      <div className="flex justify-end gap-2">
        <TextButton onClick={onCancel}>{t('取消')}</TextButton>
        {/* 改走 Button：手写版少了 disabled:* 全族，且字号/圆角与其余按钮
            不在同一套刻度上。 */}
        <Button variant="primary" size="xs" onClick={onImport}>
          {t('导入')}
        </Button>
      </div>
    </div>
  );
}
