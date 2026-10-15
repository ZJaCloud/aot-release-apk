import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const RELEASES_FILE = path.join(DATA_DIR, 'releases.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure necessary data directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function initStoreIfNeeded() {
  if (!fs.existsSync(RELEASES_FILE)) {
    const initialData = {
      nextId: 1,
      releases: [],
      emailSettings: {
        autoSendOnRelease: true,
        defaultRecipients: "qa-team@zhijiayun.com, dev-leads@zhijiayun.com, pm@zhijiayun.com",
        senderName: "智驾云 AOT 持续集成发布中心",
        senderEmail: "release-bot@zhijiayun.com",
        emailSubjectTemplate: "【智驾云/AOT】新版本发布通知 - {{releaseName}}"
      },
      githubSettings: {
        repo: "ZJaCloud/aot-release-apk",
        packageName: "com.zhijiayun.aot",
        appName: "智驾云 AOT 客户端",
        token: process.env.GITHUB_TOKEN || ""
      },
      emailLogs: []
    };
    fs.writeFileSync(RELEASES_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

export function getStore() {
  initStoreIfNeeded();
  try {
    const raw = fs.readFileSync(RELEASES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.githubSettings) {
      parsed.githubSettings = {
        repo: "ZJaCloud/aot-release-apk",
        packageName: "com.zhijiayun.aot",
        appName: "智驾云 AOT 客户端",
        token: process.env.GITHUB_TOKEN || ""
      };
    }
    return parsed;
  } catch (err) {
    console.error('Error reading store:', err);
    return {
      nextId: 1,
      releases: [],
      emailSettings: {
        autoSendOnRelease: true,
        defaultRecipients: "qa-team@zhijiayun.com, dev-leads@zhijiayun.com, pm@zhijiayun.com",
        senderName: "智驾云 AOT 持续集成发布中心",
        senderEmail: "release-bot@zhijiayun.com",
        emailSubjectTemplate: "【智驾云/AOT】新版本发布通知 - {{releaseName}}"
      },
      githubSettings: {
        repo: "ZJaCloud/aot-release-apk",
        packageName: "com.zhijiayun.aot",
        appName: "智驾云 AOT 客户端",
        token: process.env.GITHUB_TOKEN || ""
      },
      emailLogs: []
    };
  }
}

export function saveStore(data) {
  fs.writeFileSync(RELEASES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 形式 1: 邮件通知模板生成器
 */
export function generateEmailContent(release, settings) {
  const subject = (settings.emailSubjectTemplate || "【智驾云/AOT】新版本发布通知 - {{releaseName}}")
    .replace('{{releaseName}}', release.releaseName)
    .replace('{{version}}', release.version);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 24px; }
    .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .email-header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 28px 32px; color: #ffffff; }
    .email-header h1 { margin: 0 0 6px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
    .email-header p { margin: 0; font-size: 13px; opacity: 0.9; }
    .badge-pill { display: inline-block; background: rgba(255, 255, 255, 0.2); padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-top: 8px; }
    .email-body { padding: 32px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 24px; border: 1px solid #edf2f7; }
    .info-item { font-size: 13px; }
    .info-label { color: #64748b; font-size: 12px; margin-bottom: 2px; }
    .info-value { font-weight: 600; color: #0f172a; word-break: break-all; }
    .changelog-box { margin-bottom: 24px; }
    .changelog-title { font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 8px; }
    .changelog-content { background: #f1f5f9; padding: 14px 16px; border-radius: 8px; font-size: 13px; color: #334155; white-space: pre-wrap; line-height: 1.5; font-family: monospace, monospace; }
    .download-action { text-align: center; margin: 32px 0 16px 0; }
    .download-button { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 12px 32px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2); }
    .email-footer { background: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>🚀 ${subject}</h1>
      <p>智驾云 AOT 前端工程 APK 持续集成已成功生成新发布包</p>
      <div class="badge-pill">Release 标识：${release.releaseName}</div>
    </div>
    <div class="email-body">
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Release 包名称</div>
          <div class="info-value" style="color: #2563eb;">${release.releaseName}</div>
        </div>
        <div class="info-item">
          <div class="info-label">应用版本号</div>
          <div class="info-value">${release.version}</div>
        </div>
        <div class="info-item">
          <div class="info-label">APK 文件大小</div>
          <div class="info-value">${release.fileSizeFormatted}</div>
        </div>
        <div class="info-item">
          <div class="info-label">发布构建时间</div>
          <div class="info-value">${new Date(release.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>
        </div>
        <div class="info-item" style="grid-column: span 2;">
          <div class="info-label">原始上传文件名</div>
          <div class="info-value">${release.originalFileName}</div>
        </div>
        <div class="info-item" style="grid-column: span 2;">
          <div class="info-label">MD5 完整性校验</div>
          <div class="info-value" style="font-family: monospace; font-size: 12px;">${release.md5}</div>
        </div>
      </div>

      <div class="changelog-box">
        <div class="changelog-title">📋 版本更新日志与说明：</div>
        <div class="changelog-content">${escapeHtml(release.changelog || '日常构建更新，性能优化与稳定性提升')}</div>
      </div>

      <div class="download-action">
        <a href="${release.downloadUrl}" class="download-button">立即下载 ${release.releaseName}.apk</a>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 8px;">或通过平台端管理后台直接获取</div>
      </div>
    </div>
    <div class="email-footer">
      本邮件由【${settings.senderName}】自动触发发送。<br>
      通知接收人：${release.recipients.join(', ')}
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}

/**
 * 形式 2: 每次推送文件上传之后，自动打成一个 release 包 (release-数字，递增唯一)
 */
export function createReleaseFromApk({
  fileBuffer,
  originalFileName = 'app.apk',
  version,
  channel = '智驾云·车机正式版',
  changelog,
  recipients = [],
  host = 'localhost:3000',
  sendEmail = true,
  packageName = 'com.zhijiayun.aot',
  repo = 'ZJaCloud/aot-release-apk'
}) {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('未提供有效的 APK 二进制数据');
  }

  const store = getStore();

  // 严格自增的 release-数字 命名规则
  const releaseId = store.nextId;
  const releaseName = `release-${releaseId}`;
  store.nextId += 1;

  // 存储目录: data/uploads/release-N
  const releaseDir = path.join(UPLOADS_DIR, releaseName);
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  const standardApkFileName = `${releaseName}.apk`;
  const standardFilePath = path.join(releaseDir, standardApkFileName);
  fs.writeFileSync(standardFilePath, fileBuffer);

  if (originalFileName !== standardApkFileName) {
    const originalFilePath = path.join(releaseDir, originalFileName);
    fs.writeFileSync(originalFilePath, fileBuffer);
  }

  // 计算 MD5 与文件大小
  const md5 = crypto.createHash('md5').update(fileBuffer).digest('hex');
  const fileSize = fileBuffer.length;
  const fileSizeFormatted = formatBytes(fileSize);

  const cleanVersion = (version || '').trim().replace(/^v/, '');
  const finalVersion = cleanVersion ? `v${cleanVersion}` : `v1.0.${releaseId}`;
  const gitTag = finalVersion;
  const finalChangelog = changelog?.trim() || '日常构建更新，性能优化与稳定性提升';

  // 解析并处理接收人列表
  let finalRecipients = Array.isArray(recipients) ? recipients : [];
  if (typeof recipients === 'string') {
    finalRecipients = recipients.split(/[,;\n]+/).map(r => r.trim()).filter(Boolean);
  }
  if (finalRecipients.length === 0 && store.emailSettings?.defaultRecipients) {
    finalRecipients = store.emailSettings.defaultRecipients.split(/[,;\n]+/).map(r => r.trim()).filter(Boolean);
  }

  const downloadUrl = `http://${host}/api/releases/${releaseId}/download`;

  const newRelease = {
    id: releaseId,
    releaseName,
    version: finalVersion,
    gitTag,
    packageName,
    repo,
    originalFileName,
    storedFileName: standardApkFileName,
    filePath: standardFilePath,
    fileSize,
    fileSizeFormatted,
    md5,
    channel,
    changelog: finalChangelog,
    recipients: finalRecipients,
    downloadUrl,
    createdAt: new Date().toISOString(),
    status: 'ready',
    emailStatus: sendEmail ? 'sent' : 'skipped',
    emailNotification: null
  };

  let emailRecord = null;
  if (sendEmail) {
    // 形式 1: 触发邮件通知
    const emailContent = generateEmailContent(newRelease, store.emailSettings);
    emailRecord = {
      id: 'mail-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      releaseId,
      releaseName,
      subject: emailContent.subject,
      recipients: finalRecipients,
      sender: store.emailSettings.senderEmail,
      senderName: store.emailSettings.senderName,
      sentAt: new Date().toISOString(),
      status: 'success',
      html: emailContent.html,
      summary: `已向 ${finalRecipients.length} 位联系人推送 ${releaseName} 版本发布邮件`
    };

    newRelease.emailNotification = {
      sent: true,
      sentAt: emailRecord.sentAt,
      subject: emailRecord.subject,
      recipients: finalRecipients,
      previewHtml: emailRecord.html
    };

    if (!store.emailLogs) store.emailLogs = [];
    store.emailLogs.unshift(emailRecord);
  }

  // 持久化存储
  store.releases.unshift(newRelease);
  saveStore(store);

  return { release: newRelease, emailRecord };
}

/**
 * 重新派发邮件通知
 */
export function resendReleaseEmail(releaseId) {
  const store = getStore();
  const release = store.releases.find(r => r.id === releaseId);
  if (!release) {
    throw new Error(`未找到 ID 为 ${releaseId} 的 Release 记录`);
  }

  const emailContent = generateEmailContent(release, store.emailSettings);
  const emailRecord = {
    id: 'mail-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
    releaseId,
    releaseName: release.releaseName,
    subject: emailContent.subject,
    recipients: release.recipients,
    sender: store.emailSettings.senderEmail,
    senderName: store.emailSettings.senderName,
    sentAt: new Date().toISOString(),
    status: 'success',
    html: emailContent.html,
    summary: `[重新发送] 已向 ${release.recipients.join(', ')} 重新推送发布邮件`
  };

  release.emailStatus = 'sent';
  release.emailNotification = {
    sent: true,
    sentAt: emailRecord.sentAt,
    subject: emailRecord.subject,
    recipients: release.recipients,
    previewHtml: emailRecord.html
  };

  if (!store.emailLogs) store.emailLogs = [];
  store.emailLogs.unshift(emailRecord);
  saveStore(store);

  return emailRecord;
}

/**
 * 删除 Release
 */
export function deleteRelease(releaseId) {
  const store = getStore();
  const index = store.releases.findIndex(r => r.id === releaseId);
  if (index === -1) {
    throw new Error(`Release ID ${releaseId} 不存在`);
  }

  const [removed] = store.releases.splice(index, 1);
  const releaseDir = path.join(UPLOADS_DIR, removed.releaseName);
  if (fs.existsSync(releaseDir)) {
    try {
      fs.rmSync(releaseDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to remove dir:', e);
    }
  }

  saveStore(store);
  return removed;
}
