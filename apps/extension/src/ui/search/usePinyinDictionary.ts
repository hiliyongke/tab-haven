import { useEffect, useState } from 'react';
import { isPinyinDictionaryReady, preloadPinyinDictionary } from '@/core/search/SearchEngine';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 拼音词典的就绪信号，返回「此刻能否把拼音作为构造参数传给搜索引擎」。
 *
 * 存在理由：拼音词典是 1MB+ 的动态 chunk，不能进首屏。而引擎构造后不可变
 * （见 `core/search/SearchEngine`），所以词典必须在**构造之前**就绪——
 * 就绪后翻转本信号，消费方的引擎 memo 自然重建（引擎引用变化即重算），
 * 不需要任何「失效计数器」。
 *
 * 曾经的形态：引擎构造后异步原地补拼音 + UI 侧 `void tick;` 死语句把依赖数组
 * 凑自足。那行语句删掉后编译、lint、测试全绿，而拼音命中静默失效——
 * 典型的补丁式修复。现形态里「能不能拼音」是构造入参，无从被静默吞掉。
 *
 * @param enabled 设置项 `pinyinSearch`：关闭时既不加载词典，也恒返回 false。
 */
export function usePinyinDictionary(enabled: boolean): boolean {
  const [ready, setReady] = useState(() => isPinyinDictionaryReady());

  useEffect(() => {
    if (!enabled || ready) return;
    let cancelled = false;
    void preloadPinyinDictionary().then((loaded) => {
      if (cancelled) return;
      if (loaded) {
        setReady(true);
        return;
      }
      // 词典加载失败只降级拼音匹配（标题 / URL 匹配不受影响），但必须留痕：
      // 否则用户看到的「打拼音搜不到」无从归因。
      logDegraded('search', '拼音词典加载失败，本轮拼音匹配不可用');
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ready]);

  return enabled && ready;
}
