import { browser } from 'wxt/browser';
import { z } from 'zod';
import { logDegraded } from '@/platform/diagnostics';

/**
 * 跨设备同步镜像：
 * 借力浏览器账号同步通道（chrome.storage.sync），产品不经手任何数据。
 *
 * 模型：local 为主、sync 为镜像。
 *  - 本地数据每次落盘后，把固定文件夹 + 固定图标 + 设置镜像到 sync（分块存储，防 8KB/项 配额）；
 *  - 新设备首次安装（无 seeded 标志）时从镜像拉取恢复；
 *  - 超出 sync 配额时静默降级（仅丢失镜像，本地数据不受影响）。
 *
 * 同步范围：设置 + 固定集合。归档/快照等大数据不镜像。
 */

const CHUNK_PREFIX = 'tabs.sync.v1.';
const CHUNK_META_KEY = `${CHUNK_PREFIX}meta`;
/** 单块安全字符数（chrome.storage.sync 单 key 配额 8KB）。 */
const CHUNK_SIZE = 6000;
const MIRROR_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 镜像 30 天无更新视为过期

/** 镜像内容 schema（不校验设置细节，交给 SettingsSchema 在读取端校验）。 */
const MirrorPayloadSchema = z.object({
  at: z.number(),
  folders: z.array(z.unknown()),
  pins: z.array(z.unknown()),
  settings: z.record(z.string(), z.unknown())
});
type MirrorPayload = z.infer<typeof MirrorPayloadSchema>;

export interface MirrorData {
  folders: unknown[];
  pins: unknown[];
  settings: Record<string, unknown>;
}

class SyncMirror {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 去抖窗口内最新的待写数据（后写覆盖先写，保证最终落盘的是最新状态）。 */
  private pendingPayload: MirrorData | undefined;

  /** 调度一次镜像写入（合并高频写入，500ms 后落盘）。 */
  schedule(payload: MirrorData): void {
    this.pendingPayload = payload;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const latest = this.pendingPayload;
      this.pendingPayload = undefined;
      if (latest) void this.write(latest);
    }, 500);
  }

  /** 立即写入镜像（分块 + 清理过期块）。 */
  async write(payload: MirrorData): Promise<void> {
    const area = browser.storage?.sync;
    if (!area) return;
    try {
      const json = JSON.stringify({
        at: Date.now(),
        folders: payload.folders,
        pins: payload.pins,
        settings: payload.settings
      } satisfies MirrorPayload);
      const chunks: string[] = [];
      for (let i = 0; i < json.length; i += CHUNK_SIZE) {
        chunks.push(json.slice(i, i + CHUNK_SIZE));
      }
      const record: Record<string, string> = {
        [CHUNK_META_KEY]: JSON.stringify({ count: chunks.length })
      };
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (chunk === undefined) break;
        record[`${CHUNK_PREFIX}${i}`] = chunk;
      }
      // 清理上次残留的更多块（分块数只减不增时无残留，此处兜底）
      const all = await area.get(null);
      for (const key of Object.keys(all)) {
        if (key.startsWith(CHUNK_PREFIX) && !(key in record)) {
          await area.remove(key);
        }
      }
      await area.set(record);
    } catch (error) {
      // 超出同步配额或同步不可用：降级（仅丢失镜像，本地数据不受影响）。
      // 但必须可观测——否则「跨设备同步悄悄失效」对用户完全不可见。
      logDegraded('sync-mirror', '镜像写入失败，跨设备同步已降级（本地数据不受影响）', error);
    }
  }

  /** 读取镜像（不存在 / 损坏 / 过期返回 null）。 */
  async pull(): Promise<MirrorData | null> {
    const area = browser.storage?.sync;
    if (!area) return null;
    try {
      const all = await area.get(null);
      const metaRaw = all[CHUNK_META_KEY];
      if (typeof metaRaw !== 'string') return null;
      const meta = JSON.parse(metaRaw) as { count?: number };
      if (typeof meta.count !== 'number' || meta.count <= 0 || meta.count > 64) return null;
      const chunks: string[] = [];
      for (let i = 0; i < meta.count; i += 1) {
        const chunk = all[`${CHUNK_PREFIX}${i}`];
        if (typeof chunk !== 'string') return null;
        chunks.push(chunk);
      }
      const parsed = MirrorPayloadSchema.safeParse(JSON.parse(chunks.join('')));
      if (!parsed.success) return null;
      if (Date.now() - parsed.data.at > MIRROR_TTL_MS) return null;
      return {
        folders: parsed.data.folders,
        pins: parsed.data.pins,
        settings: parsed.data.settings
      };
    } catch (error) {
      // 镜像损坏 / 过期返回 null 是正常分支（上面已处理）；走到这里是解析异常，
      // 需要留痕以便区分「从未同步过」与「镜像坏了」。
      logDegraded('sync-mirror', '镜像读取失败，跳过本次恢复', error);
      return null;
    }
  }
}

/** 全局单例：dataStore 与导入流程共用。 */
export const syncMirror = new SyncMirror();
