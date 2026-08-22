import { DataFlowArt } from '../components/art/DataFlowArt';
import { Section } from '../components/Section';
import { useSiteI18n } from '../i18n';

/** 数据流转：一张图说清「数据去了哪、没去哪」。 */
export function PrivacyFlow() {
  const { t } = useSiteI18n();

  return (
    <Section
      id="privacy"
      eyebrow={t('数据流向')}
      title={t('数据从标签到本机，到此为止')}
      intro={t('通往云端那条线从来不存在 —— 图上被划掉的就是它没有的东西。')}
    >
      <div className="flow-layout">
        <div className="art-plate flow-art">
          <DataFlowArt />
        </div>
        <ul className="check-list flow-notes">
          <li>{t('标签信息从浏览器读进侧边栏，只用于展示与组织，不读取浏览历史。')}</li>
          <li>{t('文件夹、磁贴、快照与设置写进 chrome.storage.local，卸载即清除。')}</li>
          <li>{t('没有服务器、没有账号、没有遥测：诊断日志也只存在本机，需要你主动导出。')}</li>
          <li>{t('想自己验证：DevTools 的 Network 面板里看扩展上下文，请求数为零。')}</li>
        </ul>
      </div>
    </Section>
  );
}
