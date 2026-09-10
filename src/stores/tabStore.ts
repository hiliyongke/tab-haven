import { create } from 'zustand';
import { mergeSnapshotTabs, type TabGroupRecord, type TabRecord } from '@/core/tab-types';
import {
  activateTab as activateTabPlatform,
  closeTabs as closeTabsPlatform,
  createNewTab as createNewTabPlatform,
  discardTab as discardTabPlatform,
  duplicateTab as duplicateTabPlatform,
  moveGroup as moveGroupPlatform,
  recolorGroup as recolorGroupPlatform,
  renameGroup as renameGroupPlatform,
  setGroupCollapsed as setGroupCollapsedPlatform,
  toggleMute as toggleMutePlatform,
  togglePinned as togglePinnedPlatform
} from '@/platform/tabs';
import { tabSyncService } from '@/platform/sync/TabSyncService';
import { webComparisonKey } from '@/core/url/UrlInspector';
import { grantReuseAllowance } from '@/platform/reuse/reuseAllowance';
import { useDataStore } from '@/stores/dataStore';

/**
 * 标签镜像 store：真相源在浏览器，TabSyncService 把事件流统一为快照广播，
 * store 只做「快照 → 订阅者」的镜像中转。
 */

interface TabState {
  tabs: readonly TabRecord[];
  groups: readonly TabGroupRecord[];
  currentWindowId: number | undefined;
  /**
   * 是否已收到首帧标签快照。
   *
   * 初始 tabs=[] 有两种含义：同步尚未开始（首次查询在途/失败退避），或当前窗口
   * 真的没有标签。协调逻辑（reconcileWithTabs）不能把「未同步」误当成「无标签」：
   * 否则挂载早期会把磁盘上全部 item↔tab 绑定判定失效清空（与 folders 未加载
   * 是同一类初始化竞态，见 dataStore ready 守卫）。收到任意一次成功快照后为 true。
   */
  tabSyncReady: boolean;
  /** 当前浏览器高亮（多选区）的标签 id 集合，与 tabs.onHighlighted 同步。 */
  highlightedIds: ReadonlySet<number>;
  /** 切换标签（点击行为）。 */
  activateTab: (tabId: number) => Promise<void>;
  /** 关闭标签，返回实际成功的标签 id（撤销联动由调用方编排）。 */
  closeTabs: (tabIds: readonly number[]) => Promise<number[]>;
  /** 切换静音。 */
  toggleMute: (tab: TabRecord) => Promise<void>;
  /** 切换固定，返回是否成功（供 UI 按真实结果反馈）。 */
  togglePinned: (tab: TabRecord) => Promise<boolean>;
  /** 折叠/展开原生组。 */
  setGroupCollapsed: (groupId: number, collapsed: boolean) => Promise<void>;
  /** 在当前窗口新建标签。 */
  createNewTab: () => Promise<void>;
  /** 复制单个标签（对标浏览器原生右键「复制标签页」），返回是否成功。 */
  duplicateTab: (tabId: number) => Promise<boolean>;
  /** 冻结（休眠）单个标签以释放内存，返回是否成功。 */
  discardTab: (tabId: number) => Promise<boolean>;
  /** 同步浏览器高亮选区。 */
  setHighlighted: (tabIds: readonly number[]) => void;
  /** 记录单个标签探测到的语言。 */
  setLanguage: (tabId: number, lang: string) => void;
  /** 批量记录语言探测结果（一次 set，避免 N 个标签触发 N 轮全量重渲染）。 */
  setLanguages: (entries: readonly (readonly [number, string])[]) => void;
  /** 重命名原生组。 */
  renameGroup: (groupId: number, title: string) => Promise<void>;
  /** 改变原生组颜色。 */
  recolorGroup: (groupId: number, color: string) => Promise<void>;
  /** 移动原生组到指定索引（组排序）。返回是否成功（组可能已解散）。 */
  moveGroup: (groupId: number, index: number) => Promise<boolean>;
  /** 乐观重排：拖拽松手后立即本地生效，不等浏览器事件回灌（详见实现处注释）。 */
  applyReorder: (sourceId: number, targetIndex: number) => void;
  /** 整组乐观重排（分区头拖拽）：同理，把一组标签整体落到目标索引。 */
  applyGroupReorder: (sourceTabIds: readonly number[], targetIndex: number) => void;
  /** 启动同步服务（组件挂载时调用一次）；返回清理函数。 */
  startTabSync: () => () => void;
}

export const useTabStore = create<TabState>()((set, get) => ({
  tabs: [],
  groups: [],
  currentWindowId: undefined,
  tabSyncReady: false,
  highlightedIds: new Set<number>(),

  activateTab: async (tabId) => {
    await activateTabPlatform(tabId);
  },

  closeTabs: (tabIds) => closeTabsPlatform(tabIds),

  toggleMute: async (tab) => {
    await toggleMutePlatform(tab.id, Boolean(tab.muted));
  },

  togglePinned: async (tab) => togglePinnedPlatform(tab.id, tab.pinned),

  setGroupCollapsed: async (groupId, collapsed) => {
    await setGroupCollapsedPlatform(groupId, collapsed);
  },

  createNewTab: async () => {
    const position = useDataStore.getState().settings.newTabPosition;
    await createNewTabPlatform(get().currentWindowId, position);
  },

  duplicateTab: async (tabId) => {
    // 显式复制须先申请复用豁免：uniqueUrlTabs 开启时，副本若不豁免
    // 会被复用引擎合并关闭（用户看到「已复制」但标签并不存在）。
    const source = get().tabs.find((tab) => tab.id === tabId);
    const key = source ? webComparisonKey(source.url, source.pendingUrl) : null;
    if (source && key) await grantReuseAllowance(source.windowId, key);
    return duplicateTabPlatform(tabId);
  },

  discardTab: (tabId) => discardTabPlatform(tabId),

  setHighlighted: (tabIds) => {
    set({ highlightedIds: new Set(tabIds) });
  },

  setLanguage: (tabId, lang) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return {};
      const current = state.tabs[idx];
      if (!current || current.language === lang) return {};
      const tabs = state.tabs.slice();
      tabs[idx] = { ...current, language: lang };
      return { tabs };
    });
  },

  setLanguages: (entries) => {
    set((state) => {
      const byId = new Map(entries);
      let changed = false;
      const tabs = state.tabs.map((tab) => {
        const lang = byId.get(tab.id);
        if (lang === undefined || tab.language === lang) return tab;
        changed = true;
        return { ...tab, language: lang };
      });
      return changed ? { tabs } : {};
    });
  },

  renameGroup: async (groupId, title) => {
    await renameGroupPlatform(groupId, title);
  },

  recolorGroup: async (groupId, color) => {
    await recolorGroupPlatform(groupId, color);
  },

  moveGroup: async (groupId, index) => {
    return moveGroupPlatform(groupId, index);
  },

  /**
   * 乐观重排：拖拽松手后立即在本地生效，不等浏览器事件回灌。
   *
   * 真相源仍在浏览器 —— 写失败或期间有并发变化时，下一次快照会按真实顺序校正回来，
   * 因此这里不需要回滚逻辑。没有这一步，松手后要等
   * `tabs.move → 浏览器事件 → 快照广播 → React 重渲染` 的整段往返，
   * 那几十到几百毫秒的空窗正是「拖完像没反应、于是再拖一次」的来源。
   *
   * index 必须重新连续分配：显示顺序按 `index` 排序，直接拼接会留下空洞。
   */
  applyReorder: (sourceId, targetIndex) => {
    set((state) => {
      const source = state.tabs.find((tab) => tab.id === sourceId);
      if (!source) return {};
      const ordered = [...state.tabs]
        .filter((tab) => tab.id !== sourceId)
        .sort((a, b) => a.index - b.index);
      if (targetIndex < 0 || targetIndex > ordered.length) return {};
      ordered.splice(targetIndex, 0, source);
      const tabs = ordered.map((tab, i) => (tab.index === i ? tab : { ...tab, index: i }));
      return { tabs };
    });
  },

  /**
   * 整组乐观重排：分区头拖拽时把一组标签整体落到目标索引。
   * 与 applyReorder 同理（同一套「剔除 → 插入 → 重排 index」流程，只是 source 是一组）。
   * 组内相对顺序按当前 index 保持，与浏览器批量 move 的行为一致。
   */
  applyGroupReorder: (sourceTabIds, targetIndex) => {
    set((state) => {
      const sourceIds = new Set(sourceTabIds);
      const moving = state.tabs
        .filter((tab) => sourceIds.has(tab.id))
        .sort((a, b) => a.index - b.index);
      if (moving.length === 0) return {};
      const ordered = [...state.tabs]
        .filter((tab) => !sourceIds.has(tab.id))
        .sort((a, b) => a.index - b.index);
      if (targetIndex < 0 || targetIndex > ordered.length) return {};
      ordered.splice(targetIndex, 0, ...moving);
      const tabs = ordered.map((tab, i) => (tab.index === i ? tab : { ...tab, index: i }));
      return { tabs };
    });
  },

  startTabSync: () => {
    /** 本会话已应用的最新快照代数：乱序到达的旧快照直接丢弃（新鲜度守卫）。 */
    let lastAppliedGeneration = 0;
    return tabSyncService.start((snapshot) => {
      if (snapshot.generation <= lastAppliedGeneration) return;
      lastAppliedGeneration = snapshot.generation;
      set((state) => {
        // 镜像增量合并（细节见 mergeSnapshotTabs）：语言按 id 保留（URL 变化需重探测）；
        // lastAccessed 对既有标签冻结——浏览器每次激活都会刷新该时间戳，照单全收
        // 会让「最近访问」排序随每次切换标签全量重排。冻结后排序只在「新页面打开」
        // （新 id 首次出现）时一次性纳入，其余操作零重排。
        const tabs = mergeSnapshotTabs(state.tabs, snapshot.tabs);
        // 内容守卫：事件空转（广播内容与本态一致）时跳过 set，避免顶层全量重渲染。
        // mergeSnapshotTabs 对未变化标签保持原引用，此处 O(n) 指针比较即可——
        // 不必再对全量 tabs 做两次 JSON.stringify（大标签量下是每次事件的固定热点）。
        const sameTabs =
          tabs.length === state.tabs.length && tabs.every((tab, i) => tab === state.tabs[i]);
        const sameGroups =
          snapshot.groups.length === state.groups.length &&
          snapshot.groups.every((group, i) => {
            const prev = state.groups[i];
            return (
              prev !== undefined &&
              group.id === prev.id &&
              group.title === prev.title &&
              group.color === prev.color &&
              group.collapsed === prev.collapsed
            );
          });
        const sameContent = state.currentWindowId === snapshot.windowId && sameTabs && sameGroups;
        // 例外：首次成功快照即使内容与初始态相同（窗口真无标签）也必须落
        // tabSyncReady=true——下游协调据此区分「未同步」与「无标签」。
        if (sameContent && state.tabSyncReady) return {};
        return {
          tabs,
          groups: snapshot.groups,
          currentWindowId: snapshot.windowId,
          tabSyncReady: true
        };
      });
    });
  }
}));
