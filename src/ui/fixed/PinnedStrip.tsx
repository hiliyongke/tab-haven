import { pinIdentity } from '@/core/fixed/PinIdentity';
import type { PersistentPin } from '@/core/schema/models';
import { useDataStore } from '@/stores/dataStore';
import { useTabStore } from '@/stores/tabStore';
import { Favicon } from '@/ui/common/Favicon';

/**
 * 顶部永久固定图标区（行为规格 C-2）：
 * 单击切换/重新打开；中键仅关闭页面、入口保留。
 */
export function PinnedStrip() {
  const pins = useDataStore((state) => state.pins);
  const openPin = useDataStore((state) => state.openPin);
  const closeTabs = useTabStore((state) => state.closeTabs);

  if (pins.length === 0) return null;

  const handleMiddleClick = (pin: PersistentPin) => {
    const tabs = useTabStore.getState().tabs;
    const matches = tabs.filter((tab) => tab.url && pinIdentity(tab.url) === pin.identity);
    if (matches.length > 0) void closeTabs(matches.map((tab) => tab.id));
  };

  return (
    <section
      className="flex flex-wrap gap-1 border-b border-gray-100 px-2 py-1.5"
      aria-label="固定标签"
    >
      {pins.map((pin) => (
        <button
          key={pin.id}
          type="button"
          className="relative flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100"
          title={pin.title || pin.url}
          onClick={() => void openPin(pin)}
          onAuxClick={(event) => {
            if (event.button === 1) handleMiddleClick(pin);
          }}
        >
          <Favicon src={pin.favIconUrl} title={pin.title} size={18} />
        </button>
      ))}
    </section>
  );
}
