import { useTranslation } from '@/i18n';
import { Icons } from '@/ui/common/Icon';
import { RowActionButton } from '@/ui/common/RowActionButton';

/**
 * 固定文件夹头部的操作组：[打开全部 / 存为书签 / 转原生组 / 编辑 / 删除]。
 *
 * 与原生组同款布局；删除整合进 FolderEditDialog（一处承载改名与删除）。
 *
 * 从 `FolderRow` 拆出的原因：这是纯渲染的按钮组（禁用条件由 importing /
 * converting 两个入参决定），与文件夹的索引、弹窗、定位监听互不相干。
 *
 * 「打开全部」「存为书签」不改固定空间数据，故不受导入事务禁用；
 * 后三者会写固定空间，导入期间写了会被丢弃（点了「没反应」），必须禁用。
 */
export function FolderRowActions({
  importing,
  converting,
  onOpenAll,
  onExportBookmarks,
  onConvert,
  onEdit,
  onDelete
}: {
  importing: boolean;
  converting: boolean;
  onOpenAll: () => void;
  onExportBookmarks: () => void;
  onConvert: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <RowActionButton
        icon={Icons.openAll}
        label={t('打开文件夹全部条目')}
        onClick={(event) => {
          event.stopPropagation();
          onOpenAll();
        }}
      />
      <RowActionButton
        icon={Icons.bookmarkAdd}
        label={t('导出到浏览器书签')}
        onClick={(event) => {
          event.stopPropagation();
          onExportBookmarks();
        }}
      />
      <RowActionButton
        icon={Icons.toNativeGroup}
        label={t('恢复为原生标签组')}
        disabled={importing || converting}
        onClick={(event) => {
          event.stopPropagation();
          onConvert();
        }}
      />
      <RowActionButton
        icon={Icons.pencil}
        label={t('编辑文件夹')}
        disabled={importing}
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      />
      <RowActionButton
        icon={Icons.trash}
        label={t('删除文件夹（标签保留）')}
        danger
        disabled={importing}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      />
    </>
  );
}
