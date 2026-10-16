import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * APK 暂存区。
 *
 * 为什么要暂存：拖入的 APK 要先解析出包名/版本号给用户确认，确认后才真正发布。
 * 与其把 60MB 传两次，不如第一次就落到磁盘，发布时按 stagedId 取回。
 * 目录在 .gitignore 的 data/ 之下，不会入库。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

export const STAGE_DIR = path.join(ROOT_DIR, 'data', '.stage');

const MAX_AGE_MS = 60 * 60 * 1000; // 1 小时后视为残留

export function ensureStageDir() {
  fs.mkdirSync(STAGE_DIR, { recursive: true });
}

export function newStagedId() {
  return crypto.randomUUID();
}

/** 只接受 UUID 形状的 id，挡住路径穿越 */
function assertSafeId(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''))) {
    throw Object.assign(new Error('非法的暂存 ID'), { code: 'BAD_STAGED_ID' });
  }
}

export function stagedApkPath(id) {
  assertSafeId(id);
  return path.join(STAGE_DIR, `${id}.apk`);
}

export function stagedMetaPath(id) {
  assertSafeId(id);
  return path.join(STAGE_DIR, `${id}.json`);
}

export function saveMeta(id, meta) {
  fs.writeFileSync(stagedMetaPath(id), JSON.stringify(meta, null, 2), 'utf8');
}

export function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(stagedMetaPath(id), 'utf8'));
  } catch {
    return null;
  }
}

export function removeStaged(id) {
  for (const p of [stagedApkPath(id), stagedMetaPath(id)]) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* 清理失败不影响主流程 */
    }
  }
}

/** 清掉超过 1 小时的残留暂存文件，返回清理数量 */
export function sweepStale(now = Date.now()) {
  ensureStageDir();
  let removed = 0;
  for (const name of fs.readdirSync(STAGE_DIR)) {
    const p = path.join(STAGE_DIR, name);
    try {
      if (now - fs.statSync(p).mtimeMs > MAX_AGE_MS) {
        fs.rmSync(p, { force: true });
        removed++;
      }
    } catch {
      /* 忽略 */
    }
  }
  return removed;
}
