/**
 * 信任数字带。
 *
 * 每个数字都必须能在项目代码或公开说明中核验，确保展示内容准确可信。
 */
export interface ProofStat {
  /** 数字字面量：不进词典（两种语言下一致） */
  value: string;
  labelKey: string;
  noteKey: string;
}

export const PROOF_STATS: readonly ProofStat[] = [
  {
    // 依据：扩展功能不发起出站网络请求。
    value: '0',
    labelKey: '出站网络请求',
    noteKey: '扩展不发起任何网络请求，可自行用 DevTools 验证'
  },
  {
    // 出处：wxt.config.ts 的 permissions（12 项）
    value: '12',
    labelKey: '项权限逐条写明',
    noteKey: '权限用途逐项公开说明'
  },
  {
    // 出处：README 功能一览「安全网」：撤销栈深 10
    value: '10',
    labelKey: '层撤销栈',
    noteKey: '关错了可以一层层撤回来，也能整批恢复'
  },
  {
    // 出处：README 功能一览「习惯洞察」：纯本地计算零上报
    value: '100%',
    labelKey: '本机完成计算',
    noteKey: '洞察、去重、快照全在你自己的机器上算'
  }
];
