import { useTranslation } from 'react-i18next';
import { pinIdentity } from '@/core/fixed/PinIdentity';
import type { PersistentPin } from '@/core/schema/models';
import type { TabRecord } from '@/core/tab-types';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { Favicon } from '@/ui/common/Favicon';
import { TAB_DRAG_MIME } from '@/ui/tabs/TabRow';

/**
 * 顶部永久固定图标区（行为规格 C-2）：
 * 单击切换/重新打开；中键仅关闭页面、入口保留；标签可拖入固定。
 * 视觉语言：pinned-strip 磁贴（active 底部绿条、
 * closed 降透明度、audible 绿点、discarded 灰化、split 角标）。
 */

interface PinRuntime {
  openTab?: TabRecord;
  isActive: boolean;
  isAudible: boolean;
  isDiscarded: boolean;
}

function resolveRuntime(pin: PersistentPin, tabs: readonly TabRecord[]): PinRuntime {
  const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
  const openTab = matches[0];
  return {
    openTab,
    isActive: openTab?.active ?? false,
    isAudible: openTab?.audible ?? false,
    isDiscarded: openTab?.discarded ?? false
  };
}

export function PinnedStrip() {
  const { t } = useTranslation();
  const pins = useDataStore((state) => state.pins);
  const openPin = useDataStore((state) => state.openPin);
  const addPin = useDataStore((state) => state.addPin);
  const closeTabs = useTabStore((state) => state.closeTabs);
  const tabs = useTabStore((state) => state.tabs);

  if (pins.length === 0) return null;

  const handleMiddleClick = (pin: PersistentPin) => {
    const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
    if (matches.length > 0) void closeTabs(matches.map((tab) => tab.id));
  };

  const handleDrop = (event: React.DragEvent) => {
    const tabId = Number(event.dataTransfer.getData(TAB_DRAG_MIME));
    if (!Number.isInteger(tabId)) return;
    event.preventDefault();
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (tab) void addPin(tab);
  };

  return (
    <section
      className="pinned-strip"
      aria-label={t('sections.pinned')}
      data-drop-label={t('fixed.dragToPin')}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(TAB_DRAG_MIME)) event.preventDefault();
      }}
      onDrop={handleDrop}
    >
      {pins.map((pin) => {
        const rt = resolveRuntime(pin, tabs);
        const tileClass =
          'pinned-tile' +
          (rt.isActive ? ' is-active' : rt.openTab ? '' : ' is-closed') +
          (rt.isDiscarded ? ' is-discarded' : '') +
          (rt.isAudible ? ' is-audible' : '');
        return (
          <article key={pin.id} className={tileClass} draggable={false}>
            <button
              type="button"
              className="pinned-main"
              title={pin.title || pin.url}
              aria-label={pin.title || pin.url}
              onClick={() => void openPin(pin)}
              onAuxClick={(event) => {
                if (event.button === 1) handleMiddleClick(pin);
              }}
            >
              <span className="pinned-favicon-wrap">
                <Favicon src={pin.favIconUrl} title={pin.title || ''} size={18} />
              </span>
            </button>
          </article>
        );
      })}
    </section>
  );
}
