import { describe, expect, it } from 'vitest';
import { redactUrlsForTest as r } from '@/platform/log';

/** 脱敏不得误伤非 URL 文本（脱敏规则的反向约束）。 */
describe('redactUrls 误伤防护', () => {
  it('时间串不被脱敏', () => {
    expect(r('at 12:30 today')).toBe('at 12:30 today');
    expect(r('2026-09-30 15:20 failed')).toBe('2026-09-30 15:20 failed');
  });

  it('存储键名不被脱敏（塌成 <url>.v1 会让诊断无法定位是哪个键坏了）', () => {
    expect(r('数据读取失败（tabs.snapshots.v1）')).toBe('数据读取失败（tabs.snapshots.v1）');
    expect(r('数据写入失败（tabs.fixed-folders.v1）')).toBe(
      '数据写入失败（tabs.fixed-folders.v1）'
    );
    expect(r('tabs.quarantine 逐元素恢复丢弃 1 条坏元素')).toBe(
      'tabs.quarantine 逐元素恢复丢弃 1 条坏元素'
    );
    // 白名单外的同形串仍按 URL 处理（键名是有限的已知集合，豁免不泛化）。
    expect(r('访问 tabs.example.com/private 失败')).toBe('访问 <url> 失败');
  });

  it('裸 IPv4 与 IP:端口 被脱敏（内网地址同样是浏览痕迹）', () => {
    expect(r('请求 10.0.0.5 超时')).toBe('请求 <url> 超时');
    expect(r('连接 192.168.1.1:8080/admin 失败')).toBe('连接 <url> 失败');
  });
  it('文件名:行号 不被脱敏', () => {
    expect(r('file.ts:42 error')).toBe('file.ts:42 error');
  });
  it('版本号不被脱敏', () => {
    expect(r('node v22.1.0')).toBe('node v22.1.0');
  });
  it('无端口的冒号短语不被脱敏', () => {
    expect(r('operation failed: no such tab')).toBe('operation failed: no such tab');
  });
});
