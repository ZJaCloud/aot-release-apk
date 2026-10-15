import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStore,
  saveStore,
  createReleaseFromApk,
  resendReleaseEmail,
  deleteRelease
} from './services/releaseService.js';
import {
  createGitHubRelease,
  checkLatestRelease,
  DEFAULT_REPO,
  DEFAULT_PACKAGE_NAME
} from './services/githubReleaseService.js';
import {
  pushGitTag,
  GITHUB_REPO,
  SSH_REMOTE_URL
} from './services/gitService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Multipart Form-Data Parser
function parseMultipartFormData(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);

  let startIndex = 0;

  while (true) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, startIndex);
    if (boundaryIndex === -1) break;

    const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
    if (nextBoundaryIndex === -1) break;

    const partBuffer = buffer.slice(boundaryIndex + boundaryBuffer.length, nextBoundaryIndex);
    startIndex = nextBoundaryIndex;

    const headerEndIndex = partBuffer.indexOf('\r\n\r\n');
    if (headerEndIndex === -1) continue;

    const headerText = partBuffer.slice(0, headerEndIndex).toString('utf-8');
    let bodyBuffer = partBuffer.slice(headerEndIndex + 4);
    if (bodyBuffer.length >= 2 && bodyBuffer[bodyBuffer.length - 2] === 0x0d && bodyBuffer[bodyBuffer.length - 1] === 0x0a) {
      bodyBuffer = bodyBuffer.slice(0, bodyBuffer.length - 2);
    }

    const dispositionMatch = headerText.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
    if (!dispositionMatch) continue;

    const name = dispositionMatch[1];
    const filename = dispositionMatch[2] || null;

    const contentTypeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
    const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'text/plain';

    parts.push({
      name,
      filename,
      contentType,
      data: bodyBuffer
    });
  }

  return parts;
}

// MIME Types for Static Files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive'
};

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ==================== REST API ROUTES ====================

  // 1. GET /api/releases: Get release list and stats
  if (pathname === '/api/releases' && method === 'GET') {
    const store = getStore();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      code: 0,
      data: {
        releases: [...store.releases].sort((a, b) => b.id - a.id),
        total: store.releases.length,
        nextReleaseName: `release-${store.nextId}`,
        emailSettings: store.emailSettings
      }
    }));
  }

  // 2. POST /api/releases/upload: Upload APK, auto-increment release-N, generate release package & send email notification
  if (pathname === '/api/releases/upload' && method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 400, message: 'Invalid Content-Type, expected multipart/form-data' }));
    }

    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 400, message: 'Multipart boundary missing' }));
    }

    const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const fullBuffer = Buffer.concat(chunks);
        const parts = parseMultipartFormData(fullBuffer, boundary);

        let filePart = null;
        const fields = {};

        for (const part of parts) {
          if (part.filename) {
            filePart = part;
          } else {
            fields[part.name] = part.data.toString('utf-8');
          }
        }

        if (!filePart || !filePart.data || filePart.data.length === 0) {
          const sampleApkPath = path.join(__dirname, 'sample-debug.apk');
          if (fs.existsSync(sampleApkPath)) {
            filePart = {
              filename: 'sample-debug.apk',
              data: fs.readFileSync(sampleApkPath)
            };
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ code: 400, message: '未检测到有效的 APK 文件，请选择或拖拽 APK' }));
          }
        }

        const host = req.headers.host || `localhost:${PORT}`;
        const sendEmail = fields.sendEmail === 'true'; // 默认免除邮箱通知

        // Call core release engine to build release package
        const { release, emailRecord } = createReleaseFromApk({
          fileBuffer: filePart.data,
          originalFileName: filePart.filename || 'app.apk',
          version: fields.version,
          channel: fields.channel,
          changelog: fields.changelog,
          recipients: fields.recipients,
          host,
          sendEmail
        });

        // 自动创建 Git Tag 并尝试通过 SSH 推送到 GitHub
        let gitResult = null;
        try {
          gitResult = await pushGitTag({
            tag: release.gitTag,
            message: release.changelog
          });
          release.gitPushStatus = gitResult.success ? 'pushed' : 'tagged_locally';
          release.gitPushMessage = gitResult.message;
        } catch (gitErr) {
          console.warn('[Git SSH push]:', gitErr.message);
        }

        console.log(`[Release Engine] 成功生成 ${release.gitTag || release.releaseName} (${release.fileSizeFormatted}) - Git状态: ${release.gitPushStatus || 'ready'}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          code: 0,
          message: `成功生成发布包 ${release.gitTag || release.releaseName}${gitResult ? ' (' + gitResult.message + ')' : ''}`,
          data: { release, emailRecord, gitResult }
        }));
      } catch (err) {
        console.error('Error processing upload:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ code: 500, message: '服务端处理 APK 文件失败: ' + err.message }));
      }
    });
    return;
  }

  // 3. GET /api/releases/:id/download: Download APK file
  const downloadMatch = pathname.match(/^\/api\/releases\/(\d+)\/download$/);
  if (downloadMatch && method === 'GET') {
    const releaseId = parseInt(downloadMatch[1], 10);
    const store = getStore();
    const release = store.releases.find(r => r.id === releaseId);

    if (!release || !fs.existsSync(release.filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 404, message: '未找到该 Release 安装包或文件已丢失' }));
    }

    const stat = fs.statSync(release.filePath);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(release.storedFileName || `${release.releaseName}.apk`)}"`,
      'Cache-Control': 'no-cache'
    });

    const readStream = fs.createReadStream(release.filePath);
    return readStream.pipe(res);
  }

  // 4. POST /api/releases/:id/resend-email: Resend email notification
  const resendMatch = pathname.match(/^\/api\/releases\/(\d+)\/resend-email$/);
  if (resendMatch && method === 'POST') {
    const releaseId = parseInt(resendMatch[1], 10);
    try {
      const emailRecord = resendReleaseEmail(releaseId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        code: 0,
        message: `已重新向相关人员发送 ${emailRecord.releaseName} 的发布邮件`,
        data: emailRecord
      }));
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 404, message: err.message }));
    }
  }

  // 5. DELETE /api/releases/:id: Delete release
  const deleteMatch = pathname.match(/^\/api\/releases\/(\d+)$/);
  if (deleteMatch && method === 'DELETE') {
    const releaseId = parseInt(deleteMatch[1], 10);
    try {
      const removed = deleteRelease(releaseId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 0, message: `已成功删除 ${removed.releaseName}` }));
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 404, message: err.message }));
    }
  }

  // 6. GET & POST /api/email/settings
  if (pathname === '/api/email/settings') {
    const store = getStore();
    if (method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 0, data: store.emailSettings }));
    }
    if (method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          store.emailSettings = { ...store.emailSettings, ...payload };
          saveStore(store);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ code: 0, message: '邮件通知配置已保存', data: store.emailSettings }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ code: 400, message: '非法 JSON 数据' }));
        }
      });
      return;
    }
  }

  // 7. GET /api/email/logs
  if (pathname === '/api/email/logs' && method === 'GET') {
    const store = getStore();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ code: 0, data: store.emailLogs || [] }));
  }

  // 8. POST /api/github/release: Create release adhering to third-party spec
  if (pathname === '/api/github/release' && method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    const store = getStore();
    const ghConfig = store.githubSettings || {};

    if (contentType.includes('multipart/form-data')) {
      const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
      if (!boundaryMatch) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ code: 400, message: 'Multipart boundary missing' }));
      }

      const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const fullBuffer = Buffer.concat(chunks);
          const parts = parseMultipartFormData(fullBuffer, boundary);
          let filePart = null;
          const fields = {};

          for (const part of parts) {
            if (part.filename) {
              filePart = part;
            } else {
              fields[part.name] = part.data.toString('utf-8');
            }
          }

          let apkBuffer = filePart ? filePart.data : null;
          let apkFileName = filePart ? filePart.filename : null;

          if (!apkBuffer || apkBuffer.length === 0) {
            const sampleApkPath = path.join(__dirname, 'sample-debug.apk');
            if (fs.existsSync(sampleApkPath)) {
              apkBuffer = fs.readFileSync(sampleApkPath);
              apkFileName = 'sample-debug.apk';
            }
          }

          if (!apkBuffer) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ code: 400, message: '必须上传有效的 APK 文件' }));
          }

          const repo = fields.repo || ghConfig.repo || DEFAULT_REPO;
          const packageName = fields.package || fields.packageName || ghConfig.packageName || DEFAULT_PACKAGE_NAME;
          const appName = fields.appName || ghConfig.appName || '智驾云 AOT 客户端';
          const versionName = fields.version || fields.versionName || '';
          const tag = (fields.tag !== undefined && fields.tag !== '') ? fields.tag : `v${versionName.replace(/^v/, '')}`;
          const isPrerelease = fields.isPrerelease === 'true' || fields.isPrerelease === true;
          const isLatest = fields.isLatest === 'true' || fields.isLatest === true || (!isPrerelease && fields.isLatest !== 'false');
          const changelog = fields.changelog || '';
          const token = fields.token || ghConfig.token || process.env.GITHUB_TOKEN || '';
          const dryRun = fields.dryRun === 'true' || fields.dryRun === true || !token;

          const result = await createGitHubRelease({
            repo,
            tag,
            versionName,
            packageName,
            appName,
            changelog,
            isPrerelease,
            isLatest,
            apkFileName,
            apkBuffer,
            token,
            dryRun
          });

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ code: 0, message: result.message, data: result.release, dryRun: result.dryRun }));
        } catch (err) {
          console.error('[GitHub Release Error]:', err);
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ code: 400, message: err.message, validationErrors: err.validationErrors || [] }));
        }
      });
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const repo = payload.repo || ghConfig.repo || DEFAULT_REPO;
        const packageName = payload.package || payload.packageName || ghConfig.packageName || DEFAULT_PACKAGE_NAME;
        const appName = payload.appName || ghConfig.appName || '智驾云 AOT 客户端';
        const versionName = payload.version || payload.versionName || '';
        const tag = (payload.tag !== undefined && payload.tag !== '') ? payload.tag : `v${versionName.replace(/^v/, '')}`;
        const isPrerelease = Boolean(payload.isPrerelease);
        const isLatest = payload.isLatest !== undefined ? Boolean(payload.isLatest) : !isPrerelease;
        const changelog = payload.changelog || '';
        const token = payload.token || ghConfig.token || process.env.GITHUB_TOKEN || '';
        const dryRun = payload.dryRun !== undefined ? Boolean(payload.dryRun) : !token;

        const sampleApkPath = path.join(__dirname, 'sample-debug.apk');
        const apkBuffer = fs.readFileSync(sampleApkPath);

        const result = await createGitHubRelease({
          repo,
          tag,
          versionName,
          packageName,
          appName,
          changelog,
          isPrerelease,
          isLatest,
          apkFileName: 'sample-debug.apk',
          apkBuffer,
          token,
          dryRun
        });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ code: 0, message: result.message, data: result.release, dryRun: result.dryRun }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ code: 400, message: err.message, validationErrors: err.validationErrors || [] }));
      }
    });
    return;
  }

  // 9. GET /api/github/check-update: Monitor check update endpoint
  if (pathname === '/api/github/check-update' && method === 'GET') {
    const store = getStore();
    const ghConfig = store.githubSettings || {};
    const repo = parsedUrl.searchParams.get('repo') || ghConfig.repo || DEFAULT_REPO;
    const currentVersion = parsedUrl.searchParams.get('currentVersion') || 'v0.0.0';
    const token = ghConfig.token || process.env.GITHUB_TOKEN || '';

    try {
      const updateInfo = await checkLatestRelease({ repo, currentVersion, token });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 0, data: updateInfo }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 500, message: err.message }));
    }
  }

  // 10. GET & POST /api/github/config: Manage GitHub repo and token
  if (pathname === '/api/github/config') {
    const store = getStore();
    if (method === 'GET') {
      const cfg = store.githubSettings || {
        repo: DEFAULT_REPO,
        packageName: DEFAULT_PACKAGE_NAME,
        appName: '智驾云 AOT 客户端',
        token: ''
      };
      const safeConfig = {
        repo: cfg.repo || DEFAULT_REPO,
        packageName: cfg.packageName || DEFAULT_PACKAGE_NAME,
        appName: cfg.appName || '智驾云 AOT 客户端',
        hasToken: Boolean(cfg.token || process.env.GITHUB_TOKEN),
        tokenMasked: (cfg.token || process.env.GITHUB_TOKEN) ? 'ghp_••••••••••••••••' : ''
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ code: 0, data: safeConfig }));
    }
    if (method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          store.githubSettings = {
            ...(store.githubSettings || {}),
            repo: payload.repo || DEFAULT_REPO,
            packageName: payload.packageName || DEFAULT_PACKAGE_NAME,
            appName: payload.appName || '智驾云 AOT 客户端'
          };
          if (payload.token !== undefined && payload.token !== 'ghp_••••••••••••••••') {
            store.githubSettings.token = payload.token.trim();
          }
          saveStore(store);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ code: 0, message: 'GitHub 规范配置已保存' }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ code: 400, message: '非法 JSON 数据' }));
        }
      });
      return;
    }
  }

  // ==================== STATIC FILE SERVING ====================
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    return stream.pipe(res);
  }

  const indexHtml = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const stream = fs.createReadStream(indexHtml);
    return stream.pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

export { server };

// 仅在直接执行时监听端口
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 AOT APK Release 服务已启动: http://localhost:${PORT}`);
    console.log(`📦 Release 命名规则: release-数字 (唯一且自动递增)`);
    console.log(`📧 邮件通知服务: 每次推送发布自动触发邮件预览与日志`);
    console.log(`📁 存储目录: ${UPLOADS_DIR}`);
    console.log(`======================================================\n`);
  });
}
