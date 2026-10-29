import { useState } from 'react';
import { isImeComposing } from '@/core/util/keyboard';
import { useTranslation } from '@/i18n';
import { DialogShell } from '@/ui/dialog/Dialog';
import { Button } from '@/ui/common/Button';
import { TextField } from '@/ui/common/TextField';
import { groupAccentVar } from '@/ui/tabs/accent';
import { GROUP_COLOR_NAMES } from '@/core/group/groupColors';

/**
 * 组色对应的中文原文。扫描器无法从 `groups.color.<色名>` 动态拼接中提取完整 key，
 * 因此通过 `*Key` 属性收录原文，再由运行时按原文生成哈希 key 查询词典。
 */
const GROUP_COLOR_LABELS: Record<string, { labelKey: string }> = {
  grey: { labelKey: '灰色' },
  blue: { labelKey: '蓝色' },
  red: { labelKey: '红色' },
  yellow: { labelKey: '黄色' },
  green: { labelKey: '绿色' },
  pink: { labelKey: '粉色' },
  purple: { labelKey: '紫色' },
  cyan: { labelKey: '青色' },
  orange: { labelKey: '橙色' }
};

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
  // 颜色保存在草稿态，只有确认时才提交，取消操作不会写回任何变更。
  const [draftColor, setDraftColor] = useState(color);

  /** 提交草稿（改名 + 换色）并关闭：取消路径不写回任何一项。 */
  const commit = () => {
    onRename(draft.trim() || title);
    // draftColor 为 undefined 表示用户没选过色（原始 color 也可能缺省），无需写回。
    if (draftColor !== undefined && draftColor !== color) onRecolor(draftColor);
    onClose();
  };

  return (
    <DialogShell
      title={t('编辑标签组')}
      onClose={onClose}
      footer={
        /* 走 Button 而非手写 <button>：手写的没有 min-h（实高约 28px）、
           没有 transition-base / 禁用态，与同族弹窗底栏不同构。 */
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button onClick={commit}>{t('保存')}</Button>
        </>
      }
    >
      <TextField
        className="mb-3"
        ariaLabel={t('组名称')}
        placeholder={t('组名称')}
        value={draft}
        onChange={setDraft}
        onKeyDown={(e) => {
          // 输入法组合中按 Enter 是「选词」，不是「保存」。
          if (e.key === 'Enter' && !isImeComposing(e)) commit();
        }}
      />
      {/* 分组取色器：无文字、纯色块，边框是唯一的边界线索 —— 必须用 --border-control
          （原 border-gray-200 仅 1.33:1，等于看不出这是个可点控件）。
          用原生 radio（与设置页主题色板同一套写法）：色块无子内容，
          radio 完全够用，且自带 radiogroup 的键盘漫游与选中语义。
          视觉 16px / 命中 24px（::after 扩区，见 .swatch 样式）。 */}
      {/* gap-2（节距 24px）：gap-1 时相邻色块的 24px 命中区（.swatch::after inset:-4px）
          会互相重叠 4px。末元素不再带 mb —— 内容区上下留白应保持 12/12 对称。 */}
      {/* 原生 radio 已按 name 成组，外面再套 role="radiogroup" 会让部分读屏
          把组名重复播报一遍。改用 fieldset + sr-only legend：语义等价且不重复。 */}
      <fieldset className="flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">{t('编辑标签组')}</legend>
        {GROUP_COLOR_NAMES.map((c) => (
          <input
            key={c}
            type="radio"
            name="groupColor"
            checked={draftColor === c}
            className="swatch appearance-none"
            style={{ backgroundColor: groupAccentVar(c) }}
            title={t(GROUP_COLOR_LABELS[c]?.labelKey ?? c)}
            aria-label={t(GROUP_COLOR_LABELS[c]?.labelKey ?? c)}
            onChange={() => setDraftColor(c)}
          />
        ))}
      </fieldset>
    </DialogShell>
  );
}
