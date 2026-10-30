import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

/** 已存在但为空的记录属于损坏状态，不能当作首次运行而接受任意密钥。 */
export function assertIdentityRecord(
  recorded: string | undefined,
  currentId: string,
  rotate: boolean
): void {
  if (recorded === '') {
    throw new Error('签名身份记录为空或已损坏，请人工核对密钥后恢复记录');
  }
  if (recorded !== undefined && recorded !== currentId && !rotate) {
    throw new Error(`签名身份与上次不一致：记录 ${recorded}，当前 ${currentId}`);
  }
}

/** 首次打包必须拿到本轮私钥，否则成功产物也没有可复用的签名身份。 */
export function assertGeneratedSigningKey(firstPack: boolean, rawKeyExists: boolean): void {
  if (firstPack && !rawKeyExists) {
    throw new Error('首次打包未生成签名密钥，已中止；请检查浏览器的打包输出');
  }
}

/** 原子记录签名身份，避免中断时留下截断的 ID 文件。 */
export function writeIdentityRecord(file: string, id: string): void {
  const temporaryFile = `${file}.${process.pid}.tmp`;
  writeFileSync(temporaryFile, `${id}\n`, 'utf8');
  renameSync(temporaryFile, file);
}

export interface BrowserSpawnResult {
  error: Error | undefined;
  status: number | null;
  signal: string | null;
}

export function removeStaleCrx(
  file: string,
  fileExists: (path: string) => boolean = existsSync,
  removeFile: (path: string) => void = unlinkSync
): void {
  if (fileExists(file)) removeFile(file);
}

export function assertBrowserSpawnSucceeded(result: BrowserSpawnResult): void {
  if (result.error) throw new Error(`无法启动浏览器：${result.error.message}`);
  if (result.status === 0) return;

  const reason = result.signal ? `信号 ${result.signal}` : `退出码 ${String(result.status)}`;
  throw new Error(`浏览器打包失败（${reason}）`);
}
