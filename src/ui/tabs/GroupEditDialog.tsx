import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogShell } from '@/ui/dialog/Dialog';
import { TextField } from '@/ui/common/TextField';
import { groupAccentVar } from '@/ui/tabs/accent';

/** 原生组可使用的标准颜色（tabGroups 枚举）。 */
const GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange'
] as const;

/** 原生组编辑弹窗：改名 + 换色（复用 DialogShell 的焦点/键盘行为）。 */
export function GroupEditDialog({
  title,
  color,
  onRename,
  onRecolor,
  onClose
}: {
  title: string;
  color?: string;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(title);

  return (
    <DialogShell title={t('groups.edit')} onClose={onClose}>
      <TextField
        className="mb-2"
        ariaLabel={t('groups.namePlaceholder')}
        placeholder={t('groups.namePlaceholder')}
        value={draft}
        onChange={setDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onRename(draft.trim() || title);
            onClose();
          }
        }}
      />
      {/* 分组取色器：无文字、纯色块，边框是唯一的边界线索 —— 必须用 --border-control
          （原 border-gray-200 仅 1.33:1，等于看不出这是个可点控件）。
          用原生 radio（与设置页主题色板同一套写法）：色块无子内容，
          radio 完全够用，且自带 radiogroup 的键盘漫游与选中语义。
          视觉 16px / 命中 24px（::after 扩区，见 .swatch 样式）。 */}
      <div className="mb-2 flex flex-wrap gap-1" role="radiogroup" aria-label={t('groups.edit')}>
        {GROUP_COLORS.map((c) => (
          <input
            key={c}
            type="radio"
            name="groupColor"
            checked={color === c}
            className="swatch appearance-none"
            style={{ backgroundColor: groupAccentVar(c) }}
            title={c}
            aria-label={c}
            onChange={() => onRecolor(c)}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
          onClick={onClose}
        >
          {t('dialog.cancel')}
        </button>
        <button
          type="button"
          className="rounded bg-accent-600 px-3 py-1 text-sm text-on-accent hover:bg-accent-700"
          onClick={() => {
            onRename(draft.trim() || title);
            onClose();
          }}
        >
          {t('dialog.confirm')}
        </button>
      </div>
    </DialogShell>
  );
}
