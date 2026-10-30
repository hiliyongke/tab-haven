import { useTranslation } from '@/i18n';
import { Button } from '@/ui/common/Button';
import { SegmentedChip } from '@/ui/common/SegmentedChip';
import { TextField } from '@/ui/common/TextField';
import type { ImportSource } from '@/ui/snapshot/useSnapshotImport';

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
  onImport,
  importing = false
}: {
  source: ImportSource;
  onSourceChange: (source: ImportSource) => void;
  name: string;
  onNameChange: (value: string) => void;
  text: string;
  onTextChange: (value: string) => void;
  onCancel: () => void;
  onImport: () => void;
  /** 导入在途：禁用入口并给 busy 反馈，避免并发提交生成重复快照。 */
  importing?: boolean;
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
        {/* 切到导入视图后焦点落进首个源选项：触发「从 OneTab 导入」的入口按钮已随
            视图切换卸载，autoFocus 避免键盘/读屏用户焦点掉回 body。 */}
        <SegmentedChip
          autoFocus
          selected={source === 'onetab'}
          onSelect={() => onSourceChange('onetab')}
        >
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
        <Button variant="ghost" size="xs" onClick={onCancel}>
          {t('取消')}
        </Button>
        {/* 改走 Button：手写版少了 disabled:* 全族，且字号/圆角与其余按钮
            不在同一套刻度上。 */}
        {/* 内容为空或导入在途时禁用：前者避免把「什么都没粘贴」报成「该快照没有
            可恢复的标签」，后者避免并发提交生成重复快照。aria-busy 让读屏也感知进行中。 */}
        <Button
          variant="primary"
          size="xs"
          disabled={importing || text.trim().length === 0}
          busy={importing}
          onClick={onImport}
        >
          {importing ? t('导入中…') : t('导入')}
        </Button>
      </div>
    </div>
  );
}
