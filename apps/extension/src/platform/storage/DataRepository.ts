import { browser } from 'wxt/browser';
import { z, type ZodType } from 'zod';
import { logDegraded } from '@/platform/diagnostics';
import {
  LOCK_BUSY,
  QUARANTINE_RMW_LOCK,
  withCrossPageLock,
  withCrossPageLockIfAvailable
} from './crossPageLock';
import { QUARANTINE_KEY } from './keys';

/** 隔离区单条原始数据上限：超出只留摘要，避免撑爆 local 配额。 */
const QUARANTINE_ENTRY_LIMIT = 32 * 1024;
/** 超限条目保留的头部字节：够定位类型与字段，又不撑爆配额。 */
const QUARANTINE_HEAD_BYTES = 512;
/** 隔离区只留最近若干条，自身不得无界增长。 */
const QUARANTINE_MAX_ENTRIES = 20;

/**
 * 单 key 读写仓库（chrome.storage.local）：写入经 schema.parse 落盘；读取校验失败时
 * 隔离坏数据并返回默认值；订阅经 onChanged 过滤本 key。存储不可用时降级为内存态。
 */

/** 取 ZodArray 元素 schema：zod 泛型不变，instanceof 收窄后仍取不到 .element，集中此断言。 */
function zodArrayElement(schema: z.ZodArray): z.ZodTypeAny {
  return (schema as unknown as { element: z.ZodTypeAny }).element;
}

/** 深拷贝：优先 structuredClone（旧运行时缺失时退化为 JSON 往返），仅用于 JSON 同构值。 */
function cloneValue<V>(value: V): V {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as V;
}

/** 逐元素恢复失败哨兵：T 本身可为任意值（含 undefined），需与「恢复出默认值」区分。 */
const RECOVERY_FAILED = Symbol('recovery-failed');

interface DataRepositoryOptions {
  /** 存储不可用时告警。 */
  onUnavailable?: () => void;
  /**
   * 本分区 read-modify-write 跨页锁名（锁名全集见 crossPageLock.ts）。
   * 逐元素恢复的隐式回写是整表写，须在锁内基于重读结果执行，否则会覆盖期间
   * 另一上下文写入的合法数据。未配锁的键（写入方单一、无 RMW 锁名）维持锁外回写。
   */
  rmwLock?: string;
}

/** 单 key 读写仓库：读出经 zod 校验，键缺失/存储不可用/校验失败统一落回默认值深拷贝。 */
export class DataRepository<T> {
  constructor(
    private readonly key: string,
    private readonly schema: ZodType<T>,
    private readonly defaultValue: T,
    private readonly options: DataRepositoryOptions = {}
  ) {}

  /** 默认值深拷贝（经 schema 重解析）：避免把仓库持有的同一对象交给调用方被原地 push/sort 污染。 */
  private cloneDefault(): T {
    // 默认值不合法时不能抛：本方法在 read 降级分支调用，抛错会让整条读取链路崩掉。
    // schema 克隆失败退回结构化深拷贝，仍防共享引用被原地改动。
    const parsed = this.schema.safeParse(this.defaultValue);
    if (parsed.success) return parsed.data;
    logDegraded('storage', `默认值未通过 schema 校验（${this.key}），已回退为原始默认值`);
    return cloneValue(this.defaultValue);
  }

  /**
   * 数组数据逐元素恢复（丢弃坏元素 → 隔离 → 回写）。
   * 回写须在锁内基于重读结果执行：read 语义只读，这次回写是整表写，基于锁外旧快照
   * 写回会覆盖期间另一上下文写入的合法数据。重读已是合法值时直接交回，本次不写。
   * 返回 RECOVERY_FAILED 表示恢复不出合法数组（调用方按整块坏数据处置）。
   */
  private async recoverElements(
    raw: readonly unknown[],
    element: z.ZodTypeAny
  ): Promise<T | typeof RECOVERY_FAILED> {
    const lock = this.options.rmwLock;
    if (lock === undefined) return this.recoverFrom(raw, element);
    // 调用方可能已经持有同一把锁（store 的「锁内重读」是标准写法）：Web Locks 不可重入，
    // 这里若正常排队会永久悬挂（不抛错，日志里也看不出来）。改为不等待取锁；
    // 取不到只做「恢复 + 隔离」不回写，把合法值交回调用方。
    const recovered = await withCrossPageLockIfAvailable(lock, async () => {
      const area = browser.storage?.local;
      if (!area) return this.recoverFrom(raw, element);
      const fresh = (await area.get(this.key))[this.key];
      // 键已被删除：回写等于复活一份用户已丢弃的数据。
      if (fresh === undefined) return this.cloneDefault();
      // 他人已写入合法新值：直接交回，本次不写（覆盖即静默丢数据）。
      const reparsed = this.schema.safeParse(fresh);
      if (reparsed.success) return reparsed.data;
      return Array.isArray(fresh)
        ? this.recoverFrom(fresh, element)
        : // 重读到的是非数组的坏值：交回外层，由它按原快照整块隔离。
          RECOVERY_FAILED;
    });
    if (recovered === LOCK_BUSY) return this.recoverFrom(raw, element, { persist: false });
    return recovered;
  }

  /** 从给定数组恢复（丢弃坏元素 → 隔离原件 → 回写）。调用方负责锁；`persist: false` 时只恢复不落盘。 */
  private async recoverFrom(
    source: readonly unknown[],
    element: z.ZodTypeAny,
    options: { persist?: boolean } = {}
  ): Promise<T | typeof RECOVERY_FAILED> {
    const dropped: unknown[] = [];
    const kept = source.flatMap((item) => {
      const r = element.safeParse(item);
      if (r.success) return [r.data];
      dropped.push(item);
      return [];
    });
    const reparsed = this.schema.safeParse(kept);
    if (!reparsed.success) return RECOVERY_FAILED;
    // 被丢弃的原件必须先隔离再回写：顺序颠倒时「回写成功 + 隔离失败」会让坏元素永久消失且诊断无线索。
    if (dropped.length > 0) {
      logDegraded('storage', `${this.key} 逐元素恢复丢弃 ${dropped.length} 条坏元素`);
      await this.isolateCorrupted(dropped);
    }
    // 回写失败必须留痕：配额接近上限时回写恒失败，此后每次读取都会重跑恢复，诊断里毫无痕迹。
    if (options.persist === false) return reparsed.data as T;
    const written = await this.write(reparsed.data as T);
    if (!written) {
      logDegraded('storage', `坏数据恢复后回写失败（${this.key}），下次读取将重复走恢复分支`);
    }
    return reparsed.data as T;
  }

  async read(): Promise<T> {
    const area = browser.storage?.local;
    if (!area) {
      this.options.onUnavailable?.();
      return this.cloneDefault();
    }
    try {
      const stored = await area.get(this.key);
      const raw = stored[this.key];
      if (raw === undefined) return this.cloneDefault();
      const parsed = this.schema.safeParse(raw);
      if (parsed.success) return parsed.data;

      // 数组类数据：逐元素恢复，丢弃坏元素而非整块丢弃（单个坏条目不应连累全部）。
      if (this.schema instanceof z.ZodArray && Array.isArray(raw)) {
        const recovered = await this.recoverElements(raw, zodArrayElement(this.schema));
        if (recovered !== RECOVERY_FAILED) return recovered;
      }

      // 坏数据隔离：不扩散、可诊断。
      await this.isolateCorrupted(raw);
      return this.cloneDefault();
    } catch (error) {
      logDegraded('storage', `数据读取失败（${this.key}）`, error);
      this.options.onUnavailable?.();
      return this.cloneDefault();
    }
  }

  /** 写入。返回是否真实落盘（quota 超限/schema 校验失败/存储不可用均为 false）。 */
  async write(value: T): Promise<boolean> {
    const area = browser.storage?.local;
    if (!area) {
      this.options.onUnavailable?.();
      return false;
    }
    try {
      await area.set({ [this.key]: this.schema.parse(value) });
      return true;
    } catch (error) {
      logDegraded('storage', `数据写入失败（${this.key}）`, error);
      this.options.onUnavailable?.();
      return false;
    }
  }

  /** 订阅本 key 的变更（其他页面/背景写入时同步）。 */
  watch(onChange: (value: T) => void): () => void {
    const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local') return;
      const change = changes[this.key];
      if (!change) return;
      if (change.newValue === undefined) {
        // 必须走 cloneDefault：直接传 defaultValue 引用会被订阅方原地修改污染；
        // schema.parse 在默认值不合法时会抛出，而本回调在监听器内无人捕获 —— 一次坏默认值就让整条订阅链路失效。
        onChange(this.cloneDefault());
        return;
      }
      const parsed = this.schema.safeParse(change.newValue);
      if (!parsed.success) {
        // 校验失败必须留痕：静默跳过会让订阅方停在旧值，与磁盘不一致且无从排查。
        logDegraded('storage', `订阅数据校验失败（${this.key}），已跳过本次回放`, parsed.error);
        return;
      }
      onChange(parsed.data);
    };
    browser.storage?.onChanged?.addListener(listener);
    return () => browser.storage?.onChanged?.removeListener(listener);
  }

  get keyName(): string {
    return this.key;
  }

  /**
   * 坏数据隔离：不扩散、可诊断。
   * 单条体积设上限：坏数据可能是 MB 级快照，原样塞进隔离区会撑爆 local 配额，
   * 导致后续所有写入连带失败，超限只留可诊断摘要。
   * 整段 read-modify-write 须在 QUARANTINE_RMW_LOCK 内完成：所有分区的读取降级
   * 都可能写隔离区，锁外并发会互相截断条目。
   */
  private async isolateCorrupted(raw: unknown): Promise<void> {
    try {
      const serialized = JSON.stringify(raw) ?? '';
      const entry: Record<string, unknown> = {
        key: this.key,
        at: new Date().toISOString(),
        size: serialized.length
      };
      if (serialized.length <= QUARANTINE_ENTRY_LIMIT) {
        entry.raw = raw;
      } else {
        entry.truncated = true;
        entry.head = serialized.slice(0, QUARANTINE_HEAD_BYTES);
      }
      await withCrossPageLock(QUARANTINE_RMW_LOCK, async () => {
        const quarantine = await browser.storage.local.get(QUARANTINE_KEY);
        // existing 是 unknown：非数组（异常写入/旧版本残留）直接 push 会在 try 里抛错吞掉整次隔离，
        // 故用 Array.isArray 收窄，非数组时从空列表重新开始。
        const existing = quarantine[QUARANTINE_KEY];
        const list: unknown[] = Array.isArray(existing) ? existing : [];
        list.push(entry);
        await browser.storage.local.set({
          [QUARANTINE_KEY]: list.slice(-QUARANTINE_MAX_ENTRIES)
        });
      });
    } catch (error) {
      // 隔离失败不影响主流程。
      logDegraded('storage', `坏数据隔离失败（${this.key}）`, error);
    }
  }
}

/** 隔离区单条记录：raw 与 head 二选一，超 QUARANTINE_ENTRY_LIMIT 的原文只留截断摘要。 */
export interface QuarantineEntry {
  key: string;
  at: string;
  size: number;
  raw?: unknown;
  truncated?: boolean;
  head?: string;
}

/** 读取隔离区内容（供诊断区查看/导出）：只写不读等于把坏数据丢进黑洞。 */
export async function readQuarantine(): Promise<QuarantineEntry[]> {
  try {
    const stored = await browser.storage.local.get(QUARANTINE_KEY);
    const list = stored[QUARANTINE_KEY];
    return Array.isArray(list) ? (list as QuarantineEntry[]) : [];
  } catch (error) {
    logDegraded('storage', '坏数据隔离区读取失败', error);
    return [];
  }
}

/** 清空隔离区（用户在诊断区确认留档已导出后调用）。 */
export async function clearQuarantine(): Promise<void> {
  try {
    await browser.storage.local.remove(QUARANTINE_KEY);
  } catch (error) {
    logDegraded('storage', '坏数据隔离区清理失败', error);
  }
}

/**
 * 清空本机存储区域（local → session）。
 * 调用方必须先清同步镜像（clearMirror）：seeded 随 local 被清后，若镜像还在，
 * 下次初始化会把它当「跨设备首启」把旧数据复活。存储拓扑只应 platform 层知道；
 * 镜像清理以回调传入，由编排方决定是否清，仓库层不反向依赖 SyncMirror。
 */
export async function clearAllStoredData(clearMirror: () => Promise<void>): Promise<void> {
  await clearMirror();
  await browser.storage.local.clear();
  await browser.storage.session.clear();
  clearThemeMirror();
}

/** 扩展页 localStorage 里的主题镜像键（与 ThemeApplier 写入的同源），放在 platform 层以统一清除拓扑。 */
const THEME_MIRROR_KEYS = ['tabs:theme', 'tabs:theme-hue'] as const;

/**
 * 清掉主题镜像（首屏防闪用）。漏清会让用户「清除所有数据」后首帧仍按旧主题渲染。
 * 守卫 window：本函数也从无 window 的 background SW 调用，那里本就没有这份镜像。
 * 取 window.localStorage 而非裸 localStorage：后者在模拟环境可能指向不可用的同名全局。
 */
function clearThemeMirror(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of THEME_MIRROR_KEYS) window.localStorage.removeItem(key);
  } catch {
    // 页面级存储不可用时仅影响防闪烁首帧，不阻断「清除所有数据」的主流程。
  }
}
