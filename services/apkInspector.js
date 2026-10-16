import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normalizeVersion, toTag } from './githubReleaseService.js';

/**
 * 读取 APK 内的 packageName / versionName / versionCode。
 *
 * 为什么用 aapt2：versionName 在 AndroidManifest 里可能写成 @string/xxx 资源引用，
 * 纯 JS 解 AXML 还得再解 resources.arsc，成本高。aapt2 dump badging 会直接给出解析后的值。
 */

// aapt2 优先，aapt 兜底
const AAPT_BINARIES = ['aapt2', 'aapt'];

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 在 PATH 里找可执行文件 */
function which(cmd) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/** 版本号降序比较（'36.1.0' 排在 '35.0.0' 前） */
function cmpVersionDesc(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 定位可用的 aapt2 / aapt。
 * 搜索顺序：ANDROID_HOME / ANDROID_SDK_ROOT / ~/Library/Android/sdk / ~/Android/Sdk
 * 下的 build-tools/<版本>/，取版本号最高者；都没有再退回 PATH。
 */
export function resolveAapt() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'Library', 'Android', 'sdk'), // macOS 默认
    path.join(os.homedir(), 'Android', 'Sdk')             // Linux / Windows 常见
  ].filter(Boolean);

  const found = [];
  for (const root of roots) {
    const btDir = path.join(root, 'build-tools');
    if (!isDir(btDir)) continue;

    let versions = [];
    try {
      versions = fs.readdirSync(btDir).filter(d => isDir(path.join(btDir, d)));
    } catch {
      continue;
    }
    versions.sort(cmpVersionDesc);

    for (const version of versions) {
      for (const bin of AAPT_BINARIES) {
        const p = path.join(btDir, version, bin);
        if (isFile(p)) found.push({ bin, path: p, version, source: root });
      }
    }
  }

  if (found.length) {
    // 跨 SDK 根目录取版本最高者；同版本时 aapt2 先于 aapt（push 顺序 + 稳定排序）
    found.sort((a, b) => cmpVersionDesc(a.version, b.version));
    return found[0];
  }

  for (const bin of AAPT_BINARIES) {
    const p = which(bin);
    if (p) return { bin, path: p, version: 'unknown', source: 'PATH' };
  }
  return null;
}

/** 计算文件 MD5（分块读，不整包进内存） */
export function md5File(filePath) {
  const hash = crypto.createHash('md5');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * 解析 APK 元信息。
 * @param {string} apkPath 磁盘上的 APK 路径
 * @returns {{packageName:string, versionName:string, versionCode:string, version:string, tag:string, aapt:object}}
 */
export function inspectApk(apkPath) {
  if (!apkPath || !isFile(apkPath)) {
    throw Object.assign(new Error('APK 文件不存在或不可读'), { code: 'APK_NOT_FOUND' });
  }

  const aapt = resolveAapt();
  if (!aapt) {
    throw Object.assign(
      new Error(
        '找不到 aapt2 / aapt，无法读取 APK 内的版本号。\n' +
        '请安装 Android SDK 的 build-tools，或设置环境变量 ANDROID_HOME 指向 SDK 根目录。'
      ),
      { code: 'AAPT_NOT_FOUND' }
    );
  }

  let output;
  try {
    output = execFileSync(aapt.path, ['dump', 'badging', apkPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    const detail = (err.stderr || '').toString().trim() || err.message;
    throw Object.assign(
      new Error(`读取 APK 失败（${aapt.bin} dump badging 出错）：${detail}`),
      { code: 'AAPT_FAILED' }
    );
  }

  // 形如：package: name='com.xxx' versionCode='1612' versionName='V2.14.5' ...
  // 用正则抽出全部 key='value'，不依赖字段顺序
  const packageLine = output.split(/\r?\n/).find(l => l.startsWith('package:'));
  if (!packageLine) {
    throw Object.assign(
      new Error('这个文件不是有效的 APK（未读到 package 信息）'),
      { code: 'NOT_AN_APK' }
    );
  }

  const kv = {};
  for (const m of packageLine.matchAll(/(\w+)='([^']*)'/g)) kv[m[1]] = m[2];

  const packageName = kv.name || '';
  const versionName = kv.versionName || '';
  const versionCode = kv.versionCode || '';

  if (!packageName) {
    throw Object.assign(new Error('APK 内未读到 packageName'), { code: 'NO_PACKAGE_NAME' });
  }
  if (!versionName) {
    throw Object.assign(
      new Error('APK 内未读到 versionName —— 规范要求 Release tag 必须与它一致，无法自动发版'),
      { code: 'NO_VERSION_NAME' }
    );
  }

  return {
    packageName,
    versionName,
    versionCode,
    version: normalizeVersion(versionName), // 'V2.14.5' -> '2.14.5'
    tag: toTag(versionName),                // 'V2.14.5' -> 'v2.14.5'
    aapt: { bin: aapt.bin, version: aapt.version, source: aapt.source }
  };
}
