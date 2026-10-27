import { Fragment, type RefObject } from 'react';
import { useTranslation } from '@/i18n';
import {
  commandGroupLabel,
  commandGroupOf,
  EMPTY_QUERY_TAB_LIMIT,
  type CommandItem
} from '@/ui/panels/paletteCommands';
import { PaletteOption } from '@/ui/panels/paletteOption';

/**
 * 命令面板的**结果列表**：四组分区渲染 + 空态 + 截断提示。
 *
 * 与面板外壳拆开的原因：这段纯渲染占原文件近 120 行，且「每组的扁平下标 =
 * 前面各组长度之和」是容易算错的机械逻辑，和键盘状态机混在一起时改动风险高。
 * 组内下标一律由本组件按组长度推算，调用方只给全局 `activeIndex`。
 */
export function PaletteList({
  listId,
  scrollRef,
  folderItems,
  commandItems,
  recentItems,
  tabItems,
  tabTruncated,
  activeIndex,
  onHover,
  onRun
}: {
  listId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  folderItems: CommandItem[];
  commandItems: CommandItem[];
  recentItems: CommandItem[];
  tabItems: CommandItem[];
  tabTruncated: boolean;
  activeIndex: number;
  onHover: (index: number) => void;
  onRun: (cmd: CommandItem) => void;
}) {
  const { t } = useTranslation();
  const afterFolders = folderItems.length;
  const afterCommands = afterFolders + commandItems.length;
  const afterRecents = afterCommands + recentItems.length;

  return (
    <>
      <div
        id={listId}
        role="listbox"
        aria-label={t('命令面板')}
        /* overscroll-contain：本列表是浮层内的独立滚动区，不隔离会带动外层页面
           scroll-fade：结果被 max-h-72 截断，底部渐隐提示「还有更多」 */
        ref={scrollRef}
        className="scroll-fade max-h-72 overflow-y-auto overscroll-contain py-1"
      >
        {folderItems.length === 0 &&
          commandItems.length === 0 &&
          recentItems.length === 0 &&
          tabItems.length === 0 && (
            /* 与截断提示同口径：listbox 语义内只允许 option，说明性文本放外面
               （读屏可达，且不混入键盘漫游序列）。 */
            <div
              role="presentation"
              className="px-4 py-3 text-center text-3xs text-gray-500"
              aria-live="polite"
            >
              {t('没有匹配的命令或标签')}
            </div>
          )}
        {folderItems.length > 0 && (
          <div role="presentation" className="group-label px-4 pb-1 pt-2">
            {t('打开收藏夹文件夹')}
          </div>
        )}
        {folderItems.map((cmd, folderIndex) => (
          <PaletteOption
            key={cmd.id}
            cmd={cmd}
            selected={folderIndex === activeIndex}
            onSelect={() => onHover(folderIndex)}
            onRun={() => onRun(cmd)}
          />
        ))}
        {commandItems.length > 0 && (
          /* 分组标题对读屏隐藏（role=presentation）：listbox 语义内只保留 option，
             分组信息通过命令/标签的 label 本身已可区分。 */
          <div role="presentation" className="group-label px-4 pb-1 pt-2">
            {t('命令')}
          </div>
        )}
        {commandItems.map((cmd, i) => (
          <Fragment key={cmd.id}>
            {/* 组内再分标题：13 条命令平铺时，找「设置」要扫过全部。
                组标题对读屏隐藏（role=presentation）：listbox 内只保留 option，
                分组信息由命令自身的 label 承载。 */}
            {commandGroupOf(cmd.id) !== commandGroupOf(commandItems[i - 1]?.id) && (
              <div
                role="presentation"
                /* gray-500 而非 gray-400：分组标题是需要阅读的正文，gray-400
                   对 surface 仅约 2.4–2.8:1，低于 WCAG 1.4.3 的 4.5:1。 */
                className="group-label px-4 pb-0.5 pt-1.5"
              >
                {commandGroupLabel(commandGroupOf(cmd.id), t)}
              </div>
            )}
            <PaletteOption
              cmd={cmd}
              selected={afterFolders + i === activeIndex}
              onSelect={() => onHover(afterFolders + i)}
              onRun={() => onRun(cmd)}
            />
          </Fragment>
        ))}
        {recentItems.length > 0 && (
          <div role="presentation" className="group-label px-4 pb-1 pt-2">
            {t('最近关闭与快照')}
          </div>
        )}
        {recentItems.map((cmd, i) => (
          <PaletteOption
            key={cmd.id}
            cmd={cmd}
            selected={afterCommands + i === activeIndex}
            onSelect={() => onHover(afterCommands + i)}
            onRun={() => onRun(cmd)}
          />
        ))}
        {tabItems.length > 0 && (
          <div role="presentation" className="group-label px-4 pb-1 pt-2">
            {t('切换到标签')}
          </div>
        )}
        {tabItems.map((cmd, groupIndex) => (
          <PaletteOption
            key={cmd.id}
            cmd={cmd}
            selected={afterRecents + groupIndex === activeIndex}
            onSelect={() => onHover(afterRecents + groupIndex)}
            onRun={() => onRun(cmd)}
          />
        ))}
      </div>
      {tabTruncated && (
        /* 截断提示放在 listbox 外：listbox 语义内只允许 option，提示行若藏进
           listbox 只能 role=presentation，读屏用户无从得知列表被截断。 */
        <div className="border-t border-gray-100 px-4 py-1.5 text-3xs text-gray-500">
          {t('仅显示前 {{count}} 个标签，输入关键词以过滤更多', { count: EMPTY_QUERY_TAB_LIMIT })}
        </div>
      )}
    </>
  );
}
