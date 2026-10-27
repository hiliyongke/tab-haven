import { useTranslation } from '@/i18n';
import { Chip } from '@/ui/common/Chip';
import { Favicon } from '@/ui/common/Favicon';
import { Icon } from '@/ui/common/Icon';
import type { CommandItem } from '@/ui/panels/paletteCommands';

/**
 * listbox 内的单个选项（命令 / 标签通用）：图标（favicon 优先）+ 截断标签 + 选中态。
 */
export function PaletteOption({
  cmd,
  selected,
  onSelect,
  onRun
}: {
  cmd: CommandItem;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      id={`palette-item-${cmd.id}`}
      role="option"
      aria-selected={selected}
      // role=option 是交互角色，宿主必须可聚焦；tabIndex=-1 使其可程序化
      // 聚焦（DOM 焦点始终留在 combobox 输入框，靠 aria-activedescendant 漫游）。
      tabIndex={-1}
      className={
        /* transition-colors：↑↓ 漫游时的选中底色不得硬切，否则是面板里唯一没有过渡的交互元素 */
        'flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm outline-none transition-colors ' +
        (selected ? 'bg-accent-50 text-accent-700' : 'text-gray-700 hover:bg-gray-50')
      }
      onMouseEnter={onSelect}
      onClick={onRun}
    >
      {cmd.url ? (
        <span className="flex shrink-0 items-center">
          <Favicon pageUrl={cmd.url} title={cmd.label} size={16} />
        </span>
      ) : (
        <Icon d={cmd.icon} className="h-4 w-4 shrink-0 opacity-70" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{cmd.label}</span>
        {/* 字号走 text-3xs：项目纪律「正文说明 ≥ 11px」（text-2xs 仅限图标内文/徽角），
            由 design-tokens 守卫强制。 */}
        {cmd.hint && (
          <span className="block truncate text-3xs leading-snug text-gray-500">{cmd.hint}</span>
        )}
      </span>
      {/* py-px + leading-none：徽章高度由显式行高决定，不再随继承行高浮动。
          「当前」徽章走 Chip：accent + sm 与原先手写的 class 集合完全一致。 */}
      {cmd.current && (
        <Chip tone="accent" cjk size="sm" className="shrink-0 py-px leading-none">
          {t('当前')}
        </Chip>
      )}
    </div>
  );
}
