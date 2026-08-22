import { PermissionTable } from '../components/PermissionTable';
import { Section } from '../components/Section';
import { ShortcutTable } from '../components/ShortcutTable';
import { useSiteI18n } from '../i18n';

/**
 * 文档资源区：全部做成站内折叠详情。
 *
 * 项目暂不开源，因此不链任何仓库地址 —— 隐私、权限、快捷键、备份这四类内容直接
 * 写在页面里，读者不需要跳走另一个站点。
 */
export function Docs() {
  const { t } = useSiteI18n();

  return (
    <Section
      id="docs"
      eyebrow={t('文档')}
      title={t('把话说清楚的几份说明')}
      intro={t('权限为什么要用、数据存在哪、怎么自证零网络 —— 展开就能看，不需要跳转。')}
    >
      <div className="doc-grid">
        <details className="card doc-card">
          <summary>
            <h3>{t('隐私承诺与自验证')}</h3>
          </summary>
          <ul className="check-list">
            <li>
              {t(
                '扩展代码不含任何网络请求，也不发起任何出站连接；这一点由发布前的隐私回归脚本强制校验。'
              )}
            </li>
            <li>{t('数据以 chrome.storage.local 为主存储，离线可用，卸载扩展即清除。')}</li>
            <li>
              {t(
                '没有埋点，也没有崩溃上报 —— 代价是我们无法感知线上故障，诊断日志只存本机，需要你主动导出。'
              )}
            </li>
            <li>
              {t(
                '想自己验证：打开 DevTools 的 Network 面板观察扩展的 Service Worker 上下文，请求数为零。'
              )}
            </li>
          </ul>
        </details>

        <details className="card doc-card">
          <summary>
            <h3>{t('快捷键与命令')}</h3>
          </summary>
          <ShortcutTable />
        </details>

        <details className="card doc-card">
          <summary>
            <h3>{t('备份、导入与同步镜像')}</h3>
          </summary>
          <ul className="check-list">
            <li>
              {t(
                '完整备份导出导入：收藏夹、设置与全部快照和归档，单一 JSON 格式，格式不符即拒绝。'
              )}
            </li>
            <li>{t('导入是事务性的：任何一步失败都整体回滚，不会留下半份数据。')}</li>
            <li>
              {t(
                '跨设备镜像默认关闭；开启后经你自己的浏览器账号通道同步，Tabs 不经手也看不到，关闭即删除镜像。'
              )}
            </li>
            <li>{t('OneTab 文本与 Workona 导出文件也能转成快照，方便从别处搬过来。')}</li>
          </ul>
        </details>

        {/* 权限表 13 行、用途列长：塞进三分之一列会被挤成「一字一行」，必须整行铺开 */}
        <details className="card doc-card doc-card-wide">
          <summary>
            <h3>{t('权限逐条说明')}</h3>
          </summary>
          <p className="muted">
            {t('权限清单是冻结的：新增权限会令隐私回归检查失败，也会同步更新这里的说明。')}
          </p>
          <PermissionTable />
        </details>
      </div>
    </Section>
  );
}
