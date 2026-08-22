import type { ScenarioArtName } from '../components/art/scenarios';

/**
 * 使用场景：把功能翻译成「你什么时候会用到它」。
 *
 * 每条都要对应 README 功能一览里已实现的能力，不写规划中的东西。
 */
export interface ScenarioItem {
  art: ScenarioArtName;
  titleKey: string;
  descKey: string;
}

export const SCENARIOS: readonly ScenarioItem[] = [
  {
    art: 'research',
    titleKey: '查资料查到一屏同站页面',
    descKey: '同域名标签自动聚合成组，分组头带计数与静音状态，一眼看出是哪个站开了多少。'
  },
  {
    art: 'project',
    titleKey: '一个项目来回切七八个页面',
    descKey: '收进文件夹当成一个空间，拖进去就归位，需要时一键打开全部、也能导出为书签。'
  },
  {
    art: 'wrapup',
    titleKey: '下班或换机器不想丢现场',
    descKey: '关窗自动留档成快照，下次恢复前先看对照预览，只恢复真正还需要的那几个。'
  },
  {
    art: 'overload',
    titleKey: '标签多到浏览器开始卡',
    descKey: '一键清理重复（保留你正在用的那个），不看的先休眠释放内存，需要时一键唤醒。'
  }
];
