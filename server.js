import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import {
  createGitHubRelease,
  checkLatestRelease,
  formatAssetFileName,
  DEFAULT_REPO,
  DEFAULT_PACKAGE_NAME,
  DEFAULT_APP_NAME,
  normalizeVersion
} from './services/githubReleaseService.js';
import { inspectApk } from './services/apkInspector.js';
import {
  ensureStageDir,
  newStagedId,
  stagedApkPath,
  saveMeta,
  readMeta,
  removeStaged,
  sweepStale
} from './services/staging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const REPO = (process.env.GITHUB_REPO || DEFAULT_REPO).trim();
const TOKEN = (process.env.GITHUB_TOKEN || '').trim();
// 门市里看到的 App 显示名，由对接时约定；可用 GITHUB_APP_NAME 覆盖
const APP_NAME = (process.env.GITHUB_APP_NAME || DEFAULT_APP_NAME).trim();
const START_PORT = Number(process.env.PORT) || 3000;

// GitHub 单个 Release 附件上限 2GB
const MAX_APK_BYTES = 2 * 1024 * 1024 * 1024;

let actualPort = START_PORT;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

// ---------------------------------------------------------------- /api/config

function handleConfig(res) {
  sendJson(res, 200, {
    ok: true,
    repo: REPO,
    hasToken: Boolean(TOKEN),
    appName: APP_NAME,
    expectedPackageName: DEFAULT_PACKAGE_NAME,
    port: actualPort
  });
}

// ---------------------------------------------------------------- /api/inspect

/**
 * 接收原始 APK 字节（Content-Type: application/octet-stream，文件名放 X-Filename），
 * 边落盘边算 MD5，然后解析出包名/版本号返回给用户确认。不会碰 GitHub。
 */
async function handleInspect(req, res) {
  sweepStale();
  ensureStageDir();

  const stagedId = newStagedId();
  const apkPath = stagedApkPath(stagedId);

  const hash = crypto.createHash('md5');
  let size = 0;
  let tooBig = false;

  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_APK_BYTES) {
        tooBig = true;
        return cb(new Error('APK 超过 2GB，超出 GitHub 附件上限'));
      }
      hash.update(chunk);
      cb(null, chunk);
    }
  });

  try {
    await pipeline(req, meter, fs.createWriteStream(apkPath));
  } catch (err) {
    await fs.promises.rm(apkPath, { force: true });
    return sendJson(res, 400, {
      ok: false,
      error: tooBig ? err.message : `接收文件失败：${err.message}`
    });
  }

  if (size === 0) {
    await fs.promises.rm(apkPath, { force: true });
    return sendJson(res, 400, { ok: false, error: '没有收到文件内容，请重新拖入 APK' });
  }

  let info;
  try {
    info = inspectApk(apkPath);
  } catch (err) {
    await fs.promises.rm(apkPath, { force: true });
    return sendJson(res, 400, { ok: false, error: err.message, code: err.code || 'INSPECT_FAILED' });
  }

  let fileName = 'release.apk';
  try {
    const raw = req.headers['x-filename'];
    if (raw) fileName = decodeURIComponent(String(raw));
  } catch {
    /* 文件名解不出来就用默认值，不影响发布 */
  }

  const md5 = hash.digest('hex');
  saveMeta(stagedId, { fileName, size, md5, ...info, stagedAt: new Date().toISOString() });

  // 规范自检（前 4 项不通过就不该发；第 5 项只提醒，不拦）
  const checks = [
    {
      key: 'tag',
      label: 'Release tag 为 vX.Y.Z 格式',
      ok: /^v\d+\.\d+\.\d+/.test(info.tag),
      detail: info.tag
    },
    {
      key: 'version',
      label: 'tag 与 APK 内 versionName 一致',
      ok: normalizeVersion(info.tag) === normalizeVersion(info.versionName),
      detail: `${info.tag} ↔ ${info.versionName}`
    },
    {
      key: 'package',
      label: 'packageName 格式合法',
      ok: /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(info.packageName),
      detail: info.packageName
    },
    {
      key: 'apk',
      label: '产物为 .apk 附件',
      ok: fileName.toLowerCase().endsWith('.apk'),
      detail: fileName
    },
    {
      key: 'expectedPackage',
      label: `包名与对接约定一致（${DEFAULT_PACKAGE_NAME}）`,
      ok: info.packageName === DEFAULT_PACKAGE_NAME,
      warnOnly: true,
      detail: info.packageName
    }
  ];

  sendJson(res, 200, {
    ok: true,
    stagedId,
    fileName,
    size,
    md5,
    packageName: info.packageName,
    versionName: info.versionName,
    versionCode: info.versionCode,
    version: info.version,
    tag: info.tag,
    assetName: formatAssetFileName(info.packageName, info.version),
    aapt: info.aapt,
    repo: REPO,
    checks
  });
}

// ---------------------------------------------------------------- /api/publish

async function handlePublish(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: `请求体不是合法 JSON：${err.message}` });
  }

  const { stagedId, changelog = '', prerelease = false, appName, dryRun = false } = payload || {};

  let apkPath;
  try {
    apkPath = stagedApkPath(stagedId);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  if (!fs.existsSync(apkPath)) {
    return sendJson(res, 400, {
      ok: false,
      error: '暂存文件已失效（可能超过 1 小时被自动清理），请重新拖入 APK'
    });
  }

  if (!String(changelog).trim()) {
    return sendJson(res, 400, {
      ok: false,
      error: '更新说明不能为空 —— 规范要求它写进 Release 正文，会显示在车机更新弹窗里'
    });
  }

  if (!dryRun && !TOKEN) {
    return sendJson(res, 400, {
      ok: false,
      error: '未配置 GITHUB_TOKEN。请复制 .env.example 为 .env，填入 GitHub token（需 repo 权限）后重启服务。'
    });
  }

  const meta = readMeta(stagedId) || {};
  const isPrerelease = Boolean(prerelease);

  try {
    const result = await createGitHubRelease({
      repo: REPO,
      versionName: meta.versionName || meta.version,
      packageName: meta.packageName,
      appName: appName || APP_NAME,
      changelog,
      isPrerelease,
      isLatest: !isPrerelease,
      apkFilePath: apkPath,
      token: TOKEN,
      dryRun: Boolean(dryRun)
    });

    if (!dryRun) removeStaged(stagedId); // 发布成功即清掉暂存

    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    return sendJson(res, 400, {
      ok: false,
      error: err.message,
      validationErrors: err.validationErrors
    });
  }
}

// ---------------------------------------------------------------- /api/latest

/** 用第三方平台的方式回读一次 /releases/latest，验证发布结果 */
async function handleLatest(res, url) {
  const currentVersion = url.searchParams.get('current') || '';
  const result = await checkLatestRelease({ repo: REPO, currentVersion, token: TOKEN });
  sendJson(res, 200, { ok: true, ...result });
}

// ---------------------------------------------------------------- static

function serveStatic(res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    rel = '/';
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  const resolved = path.resolve(PUBLIC_DIR, '.' + path.posix.normalize(rel));
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    return fs.createReadStream(resolved).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  try {
    if (pathname === '/api/config' && method === 'GET') return handleConfig(res);
    if (pathname === '/api/inspect' && method === 'POST') return await handleInspect(req, res);
    if (pathname === '/api/publish' && method === 'POST') return await handlePublish(req, res);
    if (pathname === '/api/latest' && method === 'GET') return await handleLatest(res, url);

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: `未知接口: ${method} ${pathname}` });
    }

    return serveStatic(res, pathname);
  } catch (err) {
    console.error('[server error]', err);
    if (!res.headersSent) return sendJson(res, 500, { ok: false, error: err.message });
    res.end();
  }
});

export { server };

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  ensureStageDir();

  function startServer(port) {
    actualPort = port;
    server.listen(port, () => {
      console.log('');
      console.log('  ┌───────────────────────────────────────────────');
      console.log(`  │  打开这个地址：http://localhost:${port}`);
      console.log(`  │  目标仓库：${REPO}`);
      console.log(`  │  GitHub Token：${TOKEN ? '已配置 ✅' : '未配置 ❌（只能演练，不能真实发布）'}`);
      console.log('  └───────────────────────────────────────────────');
      console.log('');
    });
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const next = actualPort + 1;
      console.log(`\n  端口 ${actualPort} 被占用，自动改用 ${next}\n`);
      startServer(next);
    } else {
      console.error('服务启动异常:', err);
    }
  });

  startServer(actualPort);
}
