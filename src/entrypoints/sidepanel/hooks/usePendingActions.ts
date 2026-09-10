import { useCallback, useEffect, useRef } from 'react';
import {
  onRuntimeMessage,
  watchPendingActions,
  type Message,
  type PendingAction
} from '@/platform/messages';
import { useDataStore } from '@/stores/dataStore';

/**
 * 挂起动作与 runtime 消息的消费侧。
 *
 * 从 `App.tsx` 抽出（原为单文件内约 100 行的一团 useEffect + ref）。抽出的价值在于
 * 这里藏着两个**不显眼但极易写错**的约束，集中后才有可能被单测覆盖：
 *
 * 1. **双通道去重**：同一动作可能经「即时 runtime 消息」与「session.onChanged 回放」
 *    两条通道到达，必须按 `at` 时间戳去重，否则一次快捷键会被消费两次
 *    （表现为搜索框内容被全选两次）。
 * 2. **回调引用必须稳定**：本 hook 内部用 ref 保存最新回调，使 runtime 监听与
 *    挂起队列监听只在挂载时注册一次。挂起队列监听每次重挂都会异步重读一次 session，
 *    多个在途读取可能在队列清除前重复读到同一条动作。
 */

export interface PendingActionHandlers {
  /** 聚焦搜索框并全选内容（focus-search）。 */
  focusSearch: () => void;
  /** 把域名填入搜索框并聚焦（search-domain）。 */
  searchDomain: (query: string) => void;
  /** 定位当前激活标签（locate-active）。 */
  locateActive: () => void;
  /** 发生了一次重复标签复用（duplicate-reused，仅提示）。 */
  duplicateReused: () => void;
  /** 自动休眠完成，需给出可撤销提示（auto-discarded）。 */
  discardBatch: (batch: { tabIds: number[]; count: number }) => void;
}

export function usePendingActions(handlers: PendingActionHandlers): void {
  /**
   * 已处理的挂起动作时间戳（即时消息 + session onChanged 双通道去重）。
   * 有界：只服务「面板挂载前后」的短暂窗口，超限整体重置，最坏退化为重复执行一次。
   */
  const handledAtsRef = useRef<Set<number>>(new Set());

  /**
   * 回调的最新值。提交后更新而非渲染期赋值：并发渲染下渲染可能不提交，
   * 渲染期写 ref 会把未提交的中间值泄漏给事件监听。
   */
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const handlePendingAction = useCallback((action: PendingAction) => {
    if (action.at !== undefined) {
      const seen = handledAtsRef.current;
      if (seen.has(action.at)) return;
      seen.add(action.at);
      // 防膨胀：仅保留最近一小批。
      if (seen.size > 32) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
    }
    const current = handlersRef.current;
    if (action.type === 'search-domain' && typeof action.query === 'string') {
      current.searchDomain(action.query);
    } else if (action.type === 'locate-active') {
      current.locateActive();
    } else if (action.type === 'focus-search') {
      current.focusSearch();
    }
  }, []);

  // 面板未开时挂起的动作：打开面板后消费。
  useEffect(() => watchPendingActions(handlePendingAction), [handlePendingAction]);

  /**
   * SW → UI 消息分发。
   *
   * 单一协议入口：未经 MessageSchema 校验的消息已被 onRuntimeMessage 丢弃，
   * 这里只按 type 分发。新增消息类型时在本 switch 补分支。
   */
  useEffect(() => {
    const onMessage = (message: Message): void => {
      switch (message.type) {
        // 挂起动作经同一入口处理：即时消息与 session 挂起双通道按 at 去重。
        case 'focus-search':
        case 'search-domain':
        case 'locate-active':
          handlePendingAction(message);
          return;
        case 'auto-discarded':
          handlersRef.current.discardBatch(message);
          return;
        case 'duplicate-reused':
          handlersRef.current.duplicateReused();
          return;
        case 'settings-synced':
          // 设置落盘通知（storage.onChanged 之外的兜底同步）。
          void useDataStore.getState().refreshSettings();
          return;
        default:
          // UI → SW 方向的消息由 SW 处理，UI 无需响应。
          return;
      }
    };
    return onRuntimeMessage(onMessage);
  }, [handlePendingAction]);
}
