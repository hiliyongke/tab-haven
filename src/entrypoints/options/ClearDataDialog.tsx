import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/common/Button';
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
    <DialogShell title={t('settings.clearDataTitle')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-3xs leading-relaxed text-gray-600">{t('settings.clearDataDesc')}</p>
        <ul className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-2xs text-gray-700">
          <li>· {t('settings.clearDataItemFolders')}</li>
          <li>· {t('settings.clearDataItemSnapshots')}</li>
          <li>· {t('settings.clearDataItemUndo')}</li>
          <li>· {t('settings.clearDataItemSettings')}</li>
          <li>· {t('settings.clearDataItemSync')}</li>
        </ul>
        <p className="text-2xs font-medium text-warn-700">{t('settings.clearDataIrreversible')}</p>
        <label className="flex cursor-pointer items-start gap-2 text-2xs text-gray-700">
          <input
            type="checkbox"
            checked={ack}
            onChange={(event) => onAckChange(event.target.checked)}
            className="mt-px"
          />
          <span>{t('settings.clearDataAck')}</span>
        </label>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onExportBackup}>
            {t('settings.exportBackupFirst')}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('dialog.cancel')}
            </Button>
            <Button variant="danger" size="sm" disabled={!ack} onClick={() => void onConfirm()}>
              {t('settings.clearDataAction')}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
