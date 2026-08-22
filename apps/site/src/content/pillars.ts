/**
 * 功能区四大主题（图文交替行）。
 *
 * `art` 决定配哪一幅插画，`points` 是这一组的要点（*Key 后缀进词典）。
 * 四组覆盖了 README 功能一览的全部能力域，下方另有 10 张能力小卡做密集清单。
 */
export type PillarArt = 'organize' | 'recover' | 'tidy' | 'trust';

export interface PillarPoint {
  /**
   * 要点文案。
   *
   * 必须包成对象属性而不是数组元素：i18n-kit 的常量表通道只认「属性名以 Key 结尾」
   * 的对象字面量（`packages/i18n-kit/src/collect.ts:352`），写成 `points: ['中文']`
   * 扫不进词典，英文站会露中文。
   */
  pointKey: string;
}

export interface PillarItem {
  art: PillarArt;
  eyebrowKey: string;
  titleKey: string;
  bodyKey: string;
  points: readonly PillarPoint[];
}

export const PILLARS: readonly PillarItem[] = [
  {
    art: 'organize',
    eyebrowKey: '组织',
    titleKey: '把一屏标签收成几个能叫出名字的块',
    bodyKey: '同域名自动聚合，也能按你的想法拖成文件夹；每天都回来的页面留在顶上的常驻磁贴。',
    points: [
      { pointKey: '同域名标签自动聚合成组，可选同步为 Chrome 原生标签组' },
      { pointKey: '文件夹支持拖放排序、挂起转正、一键打开全部、导出为书签' },
      { pointKey: '标签、磁贴、分组头、文件夹条目都能拖着排，拖进文件夹自动去重' }
    ]
  },
  {
    art: 'recover',
    eyebrowKey: '找回',
    titleKey: '关错了不等于关掉了',
    bodyKey: '关闭操作进多层撤销栈，撤销历史面板还能拉回浏览器最近关闭的标签与窗口。',
    points: [
      { pointKey: '多层撤销栈，栈深 10，可以一层层撤回来' },
      { pointKey: '撤销历史面板支持任意批次恢复，恢复失败会留在历史里可重试' },
      { pointKey: '关窗自动快照，恢复前先看「将新建 / 已存在 / 跳过」的对照预览' }
    ]
  },
  {
    art: 'tidy',
    eyebrowKey: '清理',
    titleKey: '内存和秩序一起回来',
    bodyKey: '重复标签一键收拾干净，暂时不看的先休眠，7 天没动的会被提醒。',
    points: [
      { pointKey: '一键清理重复标签，保留你正在用的那个，可撤销' },
      { pointKey: '手动、批量、自动休眠，自动休眠支持域名白名单' },
      { pointKey: '重复重灾区、休眠候选、滞留预警，全部在本机计算' }
    ]
  },
  {
    art: 'trust',
    eyebrowKey: '信任',
    titleKey: '数据留在你的机器上',
    bodyKey: '没有服务器、没有账号、没有遥测；权限逐条写明用途，零网络请求可以自己验证。',
    points: [
      { pointKey: '数据以 chrome.storage.local 为主，卸载即清除' },
      { pointKey: '跨设备镜像默认关闭，开启后走你自己的浏览器账号通道' },
      { pointKey: '完整备份导出导入，单一 JSON 格式，导入失败整体回滚' }
    ]
  }
];
