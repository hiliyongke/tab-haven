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
  onKeyDown
}: {
  query: string;
  onChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  return (
    <div className="search-bar">
      <Icon d={Icons.search} className="search-bar-icon h-4 w-4" />
      <input
        ref={inputRef}
        type="search"
        className="search-bar-input"
        placeholder={t('search.placeholder')}
        aria-label={t('search.title')}
        value={query}
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
  );
}
