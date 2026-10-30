import { useCallback, useRef, useState } from 'react';
import { isOneTabTooLarge } from '@/core/snapshot/oneTabImport';
import type { Translate } from '@/i18n';
import { useSnapshotStore } from '@/stores/snapshotStore';

/**
 * 「从 OneTab / Workona 导入」的表单态与提交逻辑。
 *
 * 从 `SnapshotsPanel` 拆出：导入是面板里唯一「有自己的输入态（来源 / 正文 /
 * 命名）+ 一整套失败分流文案」的子流程，混在主组件里时 739 行的面板里要同时
 * 照顾列表、恢复、重命名、删除与这段导入，任一条改动都要在整片上下文中定位。
 *
 * 拆出后面板只消费 `{ source, text, name, ... }` 与 `runImport`，导入的失败口径
 * （过大 / 非 JSON / 非 Workona / 无网址 / 截断）集中在 `runImport` 一处。
 */
/** 导入来源：OneTab 纯文本 / Workona 导出 JSON。 */
export type ImportSource = 'onetab' | 'workona';

export function useSnapshotImport(params: {
  t: Translate;
  notify: (message: string) => void;
  notifyFailure: (scope: string, message: string, error: unknown) => void;
  /** 导入成功后回到列表视图。 */
  onDone: () => void;
}): {
  source: ImportSource;
  text: string;
  name: string;
  setSource: (source: ImportSource) => void;
  setText: (text: string) => void;
  setName: (name: string) => void;
  /** 导入在途态：驱动按钮禁用与 busy 文案，避免并发提交。 */
  importing: boolean;
  runImport: () => Promise<void>;
} {
  const { t, notify, notifyFailure, onDone } = params;
  const [source, setSource] = useState<'onetab' | 'workona'>('onetab');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  /**
   * 导入在途标尺：importOneTab / importWorkona 是异步写盘（Workona 会循环逐份
   * persistSnapshot），渲染期 state（importing）同 tick 连点读到旧值会并发穿透，
   * 生成重复快照。importing 只承担按钮禁用态，同 tick 连点靠 ref 拦。
   */
  const [importing, setImporting] = useState(false);
  const importInFlight = useRef(false);

  const clear = useCallback(() => {
    setText('');
    setName('');
  }, []);

  const runImport = useCallback(async () => {
    // 同 tick 连点用 ref 拦（importing state 驱动按钮禁用，但反应比重渲染慢一拍）。
    if (importInFlight.current) return;
    importInFlight.current = true;
    setImporting(true);
    try {
      const { importOneTab, importWorkona } = useSnapshotStore.getState();
      if (source === 'workona') {
        const result = await importWorkona(text);
        // 失败按原因分流（与备份导入 version-mismatch / invalid 同口径）：
        // 「文件拿错了」「文件不是 JSON」「JSON 不是 Workona 导出」三种失败
        // 统一表现为「导入 0 条」时，用户无从判断下一步该做什么。
        if (result.reason === 'too-large') {
          notify(t('文件太大（超过 1MB），请分成几份分别导入'));
          return;
        }
        if (result.reason === 'invalid-json') {
          notify(t('这不是合法的 JSON：文件可能被截断或损坏，请重新导出一次'));
          return;
        }
        if (result.reason === 'unrecognized') {
          notify(
            t('这段 JSON 不是 Workona 导出：顶层需要有 "Workspaces" 或 "Archived Workspaces" 字段')
          );
          return;
        }
        if (result.snapshots === 0) {
          // 结构合法但没产出快照：区分「没粘贴内容」与「识别到了但条目全不可恢复」。
          notify(
            text.trim()
              ? result.skipped > 0
                ? t('识别到 {{count}} 个工作区，但其中没有可打开的网页地址', {
                    count: result.skipped
                  })
                : t('没找到网址：请粘贴 OneTab 导出的文本（每行一个网址），内容不超过 1MB')
              : t('该快照没有可恢复的标签')
          );
          return;
        }
        // `tabs` 是**落盘**标签数（parseWorkona 的 totalTabs 按最终保留的份重算），
        // 与下面「未导入」里的 truncatedTabs 不是一个分母：两句分别是「进了多少」
        // 和「丢了多少」，不能相加也不能互相折算。
        notify(
          t('已导入 {{snapshots}} 份快照（共 {{tabs}} 个标签）', {
            snapshots: result.snapshots,
            tabs: result.tabs
          })
        );
        // 截断必须显式告知：导入成功但静默少了一批标签/快照，是最难自查的一类问题。
        if (result.truncatedTabs > 0 || result.truncatedSnapshots > 0) {
          notify(
            t(
              '部分内容未导入：{{tabs}} 个标签、{{snapshots}} 份快照（超出存储上限，或不是 http/https 网址）',
              {
                tabs: result.truncatedTabs,
                snapshots: result.truncatedSnapshots
              }
            )
          );
        }
        clear();
        onDone();
        return;
      }
      const { count, truncated } = await importOneTab(text, name.trim() || undefined);
      if (count === 0) {
        // 区分「用户没粘贴内容」与「粘贴了但解析不出条目」：后者可能是超 1MB
        // 被直接拒收，或整段都不是 http(s) 网址。笼统提示会让用户以为导入成功
        // 却得到一个空快照，无从排查。
        const message = !text.trim()
          ? t('该快照没有可恢复的标签')
          : isOneTabTooLarge(text)
            ? t('内容超过 1MB 上限，请分批粘贴后再导入')
            : t(
                '没能解析出网址：请确认粘贴的是 OneTab 导出的文本（每行一个 http/https 网址），且内容不超过 1MB'
              );
        notify(message);
        return;
      }
      notify(
        truncated
          ? t('已导入 {{count}} 个标签（超出 1000 条上限的部分已忽略）', { count })
          : t('已导入 {{count}} 个标签', { count })
      );
      clear();
      onDone();
    } catch (error) {
      // 走 notifyFailure：保存/导入/恢复/删除/重命名都是写路径，失败必须进诊断
      // 导出，否则「点了没反应」在用户与开发者两侧都无从定位。
      notifyFailure('snapshots', t('操作失败，请稍后重试'), error);
    } finally {
      // 所有出口（成功 return / 失败分流 return / 抛错）都复位，避免按钮永久禁用。
      importInFlight.current = false;
      setImporting(false);
    }
  }, [clear, name, notify, notifyFailure, onDone, source, t, text]);

  return { source, text, name, setSource, setText, setName, importing, runImport };
}
