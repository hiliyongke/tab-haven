import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertBrowserSpawnSucceeded,
  assertGeneratedSigningKey,
  assertIdentityRecord,
  removeStaleCrx,
  writeIdentityRecord
} from '../../scripts/pack-crx-process.ts';

describe('CRX 浏览器打包进程', () => {
  it('身份记录经临时文件原子替换且不残留临时文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabs-crx-identity-'));
    const file = join(dir, 'tabs.pem.id');

    try {
      writeIdentityRecord(file, 'abcdefghijklmnop');
      writeIdentityRecord(file, 'ponmlkjihgfedcba');

      expect(readFileSync(file, 'utf8')).toBe('ponmlkjihgfedcba\n');
      expect(readdirSync(dir)).toEqual(['tabs.pem.id']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('身份记录写入失败时保留旧值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabs-crx-identity-'));
    const file = join(dir, 'tabs.pem.id');

    try {
      writeIdentityRecord(file, 'abcdefghijklmnop');
      // 用目录占用临时文件路径，writeFileSync 必定失败且 rename 尚未执行。
      const temporaryFile = `${file}.${process.pid}.tmp`;
      mkdirSync(temporaryFile);
      expect(() => writeIdentityRecord(file, 'ponmlkjihgfedcba')).toThrow();
      expect(readFileSync(file, 'utf8')).toBe('abcdefghijklmnop\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('空身份记录按损坏拒绝，显式轮换才允许不同身份', () => {
    expect(() => assertIdentityRecord('', 'abcdefghijklmnop', false)).toThrow('为空或已损坏');
    expect(() => assertIdentityRecord('ponmlkjihgfedcba', 'abcdefghijklmnop', false)).toThrow(
      '签名身份与上次不一致'
    );
    expect(() => assertIdentityRecord('ponmlkjihgfedcba', 'abcdefghijklmnop', true)).not.toThrow();
    expect(() => assertIdentityRecord(undefined, 'abcdefghijklmnop', false)).not.toThrow();
  });

  it('首次打包缺少本轮私钥时拒绝继续，复用密钥打包不要求新 PEM', () => {
    expect(() => assertGeneratedSigningKey(true, false)).toThrow('未生成签名密钥');
    expect(() => assertGeneratedSigningKey(true, true)).not.toThrow();
    expect(() => assertGeneratedSigningKey(false, false)).not.toThrow();
  });

  it('先删除上一轮遗留的 CRX 与首次打包 PEM', () => {
    const removedFiles: string[] = [];
    const remove = (file: string) => removedFiles.push(file);

    removeStaleCrx('chrome-mv3.crx', () => true, remove);
    removeStaleCrx('chrome-mv3.pem', () => true, remove);

    expect(removedFiles).toEqual(['chrome-mv3.crx', 'chrome-mv3.pem']);
  });

  it('启动浏览器失败时拒绝继续打包', () => {
    expect(() =>
      assertBrowserSpawnSucceeded({
        error: new Error('ENOENT'),
        status: null,
        signal: null
      })
    ).toThrow('无法启动浏览器：ENOENT');
  });

  it('浏览器退出码非零或被信号终止时拒绝继续打包', () => {
    expect(() =>
      assertBrowserSpawnSucceeded({ error: undefined, status: 1, signal: null })
    ).toThrow('退出码 1');
    expect(() =>
      assertBrowserSpawnSucceeded({ error: undefined, status: null, signal: 'SIGTERM' })
    ).toThrow('信号 SIGTERM');
  });

  it('浏览器以退出码 0 结束时允许继续检查产物', () => {
    expect(() =>
      assertBrowserSpawnSucceeded({ error: undefined, status: 0, signal: null })
    ).not.toThrow();
  });
});
