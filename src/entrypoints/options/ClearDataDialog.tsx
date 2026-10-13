import { useTranslation } from '@/i18n';
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
    <DialogShell
      title={t('清除所有数据')}
      onClose={onClose}
      /* 动作行走 footer（与确认类弹窗同一底栏），不再挤在内容区里靠 pt-1 凑间距；
         按钮回到默认 md(32px) —— size="sm"(24px) 与同族弹窗不同档。 */
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
        <ul className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-2xs text-gray-700">
          <li>· {t('固定空间与常驻磁贴')}</li>
          <li>· {t('全部快照与归档')}</li>
          <li>· {t('可撤销的关闭记录')}</li>
          <li>· {t('全部设置（恢复为默认值）')}</li>
          <li>· {t('跨设备同步镜像')}</li>
        </ul>
        <p className="text-2xs font-medium text-warn-700">
          {t('此操作不可恢复。建议先导出一份备份。')}
        </p>
        {/* items-start 让复选框与多行说明首行顶部对齐，不再靠 mt-px(1px) 微调 */}
        <label className="flex cursor-pointer items-start gap-2 text-2xs text-gray-700">
          <input
            type="checkbox"
            checked={ack}
            onChange={(event) => onAckChange(event.target.checked)}
            className="mt-0.5"
          />
          <span>{t('我已了解上述数据将被永久删除，且无法恢复')}</span>
        </label>
      </div>
    </DialogShell>
  );
}
