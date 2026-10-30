import { useState } from 'react';
import { isImeComposing } from '@/core/util/keyboard';
import { useTranslation } from '@/i18n';
import { Icon, Icons } from '@/ui/common/Icon';
import { IconButton } from '@/ui/common/IconButton';

/**
 * 常驻顶部搜索框，输入即过滤：
 * 输入即实时过滤下方标签列表，无需点击弹窗。
 * ⌘K / Ctrl+K 由上层聚焦此输入框；Esc 清空。
 */
export function SearchBar({
  query,
  onChange,
  inputRef,
  onKeyDown,
  showKeyboardHint = false,
  showHistoryToggle = false,
  historyOn = false,
  onToggleHistory
}: {
  query: string;
  onChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  /** 是否允许显示键盘导航提示（↑↓/Enter/Esc）；实际只在输入框聚焦时呈现。 */
  showKeyboardHint?: boolean;
  /** 是否显示「包含历史」开关（仅 sidepanel 装配时传入）。 */
  showHistoryToggle?: boolean;
  /** 历史搜索当前开关态（决定按钮激活样式与提示文案）。 */
  historyOn?: boolean;
  /** 切换历史搜索（含快照/归档索引）。 */
  onToggleHistory?: () => void;
}) {
  const { t } = useTranslation();
  /** 聚焦态：提示只在用户把焦点放进搜索框时出现，避免常驻占位与视觉噪音。 */
  const [focused, setFocused] = useState(false);
  return (
    <>
      {/* input-row：下划线式输入的容器级承载（与命令面板输入行、弹窗输入框同一组
          声明，见 main.css「输入落位语言」），别在这里另写一份边框。 */}
      <div className="search-bar input-row">
        <Icon d={Icons.search} className="search-bar-icon h-4 w-4" />
        <input
          ref={inputRef}
          type="search"
          className="search-bar-input"
          placeholder={t('搜索标签（标题 / 网址 / 拼音）')}
          aria-label={t('搜索标签')}
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            // Esc 在输入法组合中用于取消候选，不能同时把已输入的搜索词清掉。
            if (!event.defaultPrevented && event.key === 'Escape' && !isImeComposing(event)) {
              event.preventDefault();
              onChange('');
            }
          }}
        />
        {/* 刻意保留裸 button：它是 toggle 语义（aria-pressed），而 Button /
            IconButton / RowActionButton 都不下发 aria-pressed；换成它们会让读屏
            丢失「开 / 关」状态。视觉与命中区由 .search-bar-history 承担。 */}
        {showHistoryToggle && onToggleHistory && (
          <button
            type="button"
            className={'search-bar-history' + (historyOn ? ' is-active' : '')}
            /* WAI-ARIA toggle button：可访问名保持**稳定**，开/关只由 aria-pressed 表达。
               名称随状态变化时读屏会同时念「变化的名字」与「按下态」，语义冗余且易混
               （与 PresetsPanel / SegmentedChip 的稳定名口径一致）。title 仍随状态给出
               更具体的鼠标提示，不影响可访问名。 */
            title={historyOn ? t('包含历史（快照/归档）') : t('仅搜索当前标签')}
            aria-label={t('包含历史（快照/归档）')}
            aria-pressed={historyOn}
            onClick={() => {
              onToggleHistory();
              inputRef.current?.focus();
            }}
          >
            <Icon d={Icons.history} className="h-3.5 w-3.5" />
          </button>
        )}
        {/* 圆角胶囊与 24px 命中区由 .search-bar-clear（unlayered）承担，
            IconButton 只补 label / disabled / 焦点环口径。 */}
        {query && (
          <IconButton
            icon={Icons.close}
            iconClass="h-3.5 w-3.5"
            label={t('清除搜索')}
            className="search-bar-clear"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          />
        )}
      </div>
      {showKeyboardHint && focused && (
        <p className="search-keyboard-hint" aria-hidden="true">
          {t('↑↓ 选择 · Enter 切换 · Esc 清除')}
        </p>
      )}
    </>
  );
}
