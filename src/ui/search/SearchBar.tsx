import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons } from '@/ui/common/Icon';

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
  showKeyboardHint = false
}: {
  query: string;
  onChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  /** 是否允许显示键盘导航提示（↑↓/Enter/Esc）；实际只在输入框聚焦时呈现。 */
  showKeyboardHint?: boolean;
}) {
  const { t } = useTranslation();
  /** 聚焦态：提示只在用户把焦点放进搜索框时出现，避免常驻占位与视觉噪音。 */
  const [focused, setFocused] = useState(false);
  return (
    <>
      <div className="search-bar">
        <Icon d={Icons.search} className="search-bar-icon h-4 w-4" />
        <input
          ref={inputRef}
          type="search"
          className="search-bar-input"
          placeholder={t('search.placeholder')}
          aria-label={t('search.title')}
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (!event.defaultPrevented && event.key === 'Escape') {
              event.preventDefault();
              onChange('');
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="search-bar-clear"
            title={t('search.clear')}
            aria-label={t('search.clear')}
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          >
            <Icon d={Icons.close} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showKeyboardHint && focused && (
        <p className="search-keyboard-hint" aria-hidden="true">
          {t('search.keyboardHint')}
        </p>
      )}
    </>
  );
}
