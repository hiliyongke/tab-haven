/**
 * 工作原理三步：它每天在后台替你做的事。
 *
 * 与「快速开始」区分开：那边讲你怎么装，这里讲它怎么工作。
 */
export interface WorkStep {
  titleKey: string;
  descKey: string;
}

export const WORK_STEPS: readonly WorkStep[] = [
  {
    titleKey: '监听',
    descKey: '读取当前窗口的标签事件，标题、地址、固定与静音状态一并跟上，不读取浏览历史。'
  },
  {
    titleKey: '组织',
    descKey: '同域名自动聚合成分组，你的文件夹与常驻磁贴常驻顶部，拖一下就能改顺序。'
  },
  {
    titleKey: '留痕',
    descKey: '每次关闭都记进撤销栈，关窗时自动留一份快照；之后随时按批次回看或恢复。'
  }
];
