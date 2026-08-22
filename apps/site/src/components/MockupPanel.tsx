import { FolderOpen, Search, Undo2 } from 'lucide-react';
import { useSiteI18n } from '../i18n';

/**
 * 界面演示：侧边栏用 CSS 画出来，不用截图。
 *
 * 为什么不用截图：仓库里没有真实 UI 截图，而放占位图等于没放；纯 CSS 绘制零图片
 * 请求、随时可改，且能随设计令牌一起换肤。
 *
 * 面板里的示例数据是**固定英文**（域名与示例标题），与真实截图同性质：不进词典、
 * 两种语言下一致，避免英文产物里混入待翻译的界面示例。
 */
export type MockupVariant = 'main' | 'search' | 'fixed' | 'undo';

const TILES: readonly { letter: string; tone: string }[] = [
  { letter: 'D', tone: 'a' },
  { letter: 'N', tone: 'b' },
  { letter: 'S', tone: 'c' },
  { letter: 'G', tone: 'd' }
];

function SearchBar({ placeholder }: { placeholder: string }) {
  return (
    <div className="mp-search">
      <Search size={12} aria-hidden="true" />
      <span className="mp-placeholder">{placeholder}</span>
    </div>
  );
}

function Tiles() {
  return (
    <div className="mp-tiles">
      {TILES.map((tile) => (
        <span key={tile.letter} className={`mp-tile mp-tile--${tile.tone}`}>
          {tile.letter}
        </span>
      ))}
    </div>
  );
}

function GroupHead({ host, count }: { host: string; count: number }) {
  return (
    <div className="mp-group-head">
      <span className="mp-bar" aria-hidden="true" />
      <span className="mp-group-title">{host}</span>
      <span className="mp-count">{count}</span>
    </div>
  );
}

function Row({ title, hit, dim }: { title: string; hit?: string; dim?: boolean }) {
  const parts = hit ? title.split(hit) : [title];
  return (
    <div className={`mp-row${dim ? ' is-dim' : ''}`}>
      <span className="mp-favicon" aria-hidden="true">
        {title.slice(0, 1)}
      </span>
      <span className="mp-row-title">
        {hit && parts.length === 2 ? (
          <>
            {parts[0]}
            <mark>{hit}</mark>
            {parts[1]}
          </>
        ) : (
          title
        )}
      </span>
    </div>
  );
}

function MainPanel({ placeholder }: { placeholder: string }) {
  return (
    <>
      <SearchBar placeholder={placeholder} />
      <Tiles />
      <GroupHead host="docs.example.com" count={3} />
      <Row title="Design review notes" />
      <Row title="API reference · v2" />
      <Row title="Changelog" />
      <GroupHead host="news.example.com" count={2} />
      <Row title="Weekly digest" />
      <Row title="Industry roundup" dim />
      <Row title="Pricing calculator" />
    </>
  );
}

function SearchPanel({ placeholder }: { placeholder: string }) {
  return (
    <>
      <SearchBar placeholder={placeholder} />
      <GroupHead host="docs.example.com" count={2} />
      <Row title="Design review notes" hit="Design" />
      <Row title="API reference · v2" hit="reference" />
      <GroupHead host="news.example.com" count={1} />
      <Row title="Design weekly" hit="Design" />
    </>
  );
}

function FixedPanel({ folderLabel }: { folderLabel: string }) {
  return (
    <>
      <div className="mp-group-head">
        <FolderOpen size={12} aria-hidden="true" />
        <span className="mp-group-title">{folderLabel}</span>
        <span className="mp-count">2</span>
      </div>
      <div className="mp-folder">
        <span className="mp-favicon" aria-hidden="true">
          R
        </span>
        <span className="mp-row-title">Reading list</span>
        <span className="mp-count">4</span>
      </div>
      <div className="mp-folder">
        <span className="mp-favicon" aria-hidden="true">
          R
        </span>
        <span className="mp-row-title">Release checklist</span>
        <span className="mp-count">6</span>
      </div>
      <Tiles />
    </>
  );
}

function UndoPanel({ undoLabel, tabLabel }: { undoLabel: string; tabLabel: string }) {
  return (
    <>
      <div className="mp-group-head">
        <Undo2 size={12} aria-hidden="true" />
        <span className="mp-group-title">{undoLabel}</span>
      </div>
      <div className="mp-history">
        <span className="mp-history-title">{tabLabel}</span>
        <span className="mp-history-action">{undoLabel}</span>
      </div>
      <div className="mp-history">
        <span className="mp-history-title">docs.example.com</span>
        <span className="mp-history-action">{undoLabel}</span>
      </div>
      <div className="mp-history is-done">
        <span className="mp-history-title">news.example.com</span>
        <span className="mp-history-action">{undoLabel}</span>
      </div>
    </>
  );
}

export interface MockupPanelProps {
  variant: MockupVariant;
}

export function MockupPanel({ variant }: MockupPanelProps) {
  const { t } = useSiteI18n();
  const placeholder = t('搜索标签、网址或拼音');

  return (
    <div className="mockup">
      <div className="mockup-window">
        <div className="mockup-chrome" aria-hidden="true">
          <span className="mockup-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="mockup-omnibox">docs.example.com</span>
        </div>
        <div className="mockup-body">
          <div className="mockup-page" aria-hidden="true">
            <span className="sk sk-h1" />
            <span className="sk sk-line" />
            <span className="sk sk-line is-short" />
            <span className="sk sk-block" />
          </div>
          <div className="mockup-panel">
            {variant === 'main' ? <MainPanel placeholder={placeholder} /> : null}
            {variant === 'search' ? <SearchPanel placeholder={placeholder} /> : null}
            {variant === 'fixed' ? <FixedPanel folderLabel={t('收藏夹')} /> : null}
            {variant === 'undo' ? (
              <UndoPanel undoLabel={t('撤销')} tabLabel={t('{{count}} 个标签', { count: 3 })} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
