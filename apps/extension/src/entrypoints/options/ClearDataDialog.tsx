import { useTranslation } from '@/i18n';
import { Button } from '@/ui/common/Button';
import { Checkbox } from '@/ui/common/Checkbox';
import { DialogShell } from '@/ui/dialog/Dialog';

interface ClearDataDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  ack: boolean;
  onAckChange: (value: boolean) => void;
  onExportBackup: () => void;
}

/**
 * 清除全部数据确认弹窗：危险操作的双保险（勾选确认 + 二次确认）。
 * 内容故意逐项列出「会清掉什么」，避免用户点错后不知道丢了哪些资产。
 */
export function ClearDataDialog({
  open,
  onClose,
  onConfirm,
  ack,
  onAckChange,
  onExportBackup
}: ClearDataDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <DialogShell
      title={t('清除所有数据')}
      onClose={onClose}
      /* 操作按钮放在确认类弹窗共用的 footer，使用默认 md 尺寸以保持按钮档位一致。 */
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={onExportBackup}>
            {t('先导出一份备份')}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('取消')}
            </Button>
            <Button variant="danger" disabled={!ack} onClick={() => void onConfirm()}>
              {t('永久清除')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-3xs leading-relaxed text-gray-600">{t('以下数据将被永久删除：')}</p>
        <ul className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-3xs text-gray-700">
          <li>· {t('收藏夹与常驻磁贴')}</li>
          <li>· {t('全部快照与归档')}</li>
          <li>· {t('可撤销的关闭记录')}</li>
          <li>· {t('全部设置（恢复为默认值）')}</li>
          <li>· {t('跨设备同步镜像')}</li>
        </ul>
        <p className="text-3xs font-medium text-warn-700">
          {t('此操作不可恢复。建议先导出一份备份。')}
        </p>
        {/* items-start 让复选框与多行说明的首行顶部对齐。 */}
        <label className="flex cursor-pointer items-start gap-2 text-3xs text-gray-700">
          <Checkbox checked={ack} className="mt-0.5" onChange={onAckChange} />
          <span>{t('我已了解上述数据将被永久删除，且无法恢复')}</span>
        </label>
      </div>
    </DialogShell>
  );
}
