// State Management
let currentReleases = [];
let currentEmailSettings = {};
let currentSelectedReleaseForModal = null;
let selectedFile = null;

// DOM Elements
const tabButtons = document.querySelectorAll('.nav-tab');
const tabPanes = document.querySelectorAll('.tab-pane');

const statNextRelease = document.getElementById('stat-next-release');
const statTotalReleases = document.getElementById('stat-total-releases');
const statEmailCount = document.getElementById('stat-email-count');
const statStorageSize = document.getElementById('stat-storage-size');
const badgeNextName = document.getElementById('badge-next-name');

// Upload Form Elements
const uploadForm = document.getElementById('upload-form');
const apkFileInput = document.getElementById('apk-file-input');
const apkDropzone = document.getElementById('apk-dropzone');
const selectedFileBox = document.getElementById('selected-file-box');
const displayFileName = document.getElementById('display-file-name');
const displayFileSize = document.getElementById('display-file-size');
const btnRemoveFile = document.getElementById('btn-remove-file');
const inputVersion = document.getElementById('input-version');
const inputChannel = document.getElementById('input-channel');
const inputRecipients = document.getElementById('input-recipients');
const inputChangelog = document.getElementById('input-changelog');
const btnSubmitUpload = document.getElementById('btn-submit-upload');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressBar = document.getElementById('upload-progress-bar');
const progressStatusText = document.getElementById('progress-status-text');

// Release List Elements
const releaseTableBody = document.getElementById('release-table-body');
const releasesEmptyState = document.getElementById('releases-empty-state');
const searchReleaseInput = document.getElementById('search-release-input');
const btnRefreshReleases = document.getElementById('btn-refresh-releases');

// Email Center Elements
const settingSenderName = document.getElementById('setting-sender-name');
const settingSenderEmail = document.getElementById('setting-sender-email');
const settingDefaultRecipients = document.getElementById('setting-default-recipients');
const settingSubjectTemplate = document.getElementById('setting-subject-template');
const btnSaveEmailSettings = document.getElementById('btn-save-email-settings');
const emailLogsContainer = document.getElementById('email-logs-container');

// Modal Elements
const emailPreviewModal = document.getElementById('email-preview-modal');
const btnCloseEmailModal = document.getElementById('btn-close-email-modal');
const modalReleaseName = document.getElementById('modal-release-name');
const modalEmailSubject = document.getElementById('modal-email-subject');
const modalEmailRecipients = document.getElementById('modal-email-recipients');
const modalEmailTime = document.getElementById('modal-email-time');
const modalEmailIframe = document.getElementById('modal-email-iframe');
const btnCopyEmailHtml = document.getElementById('btn-copy-email-html');
const btnResendCurrentEmail = document.getElementById('btn-resend-current-email');

// ==================== TABS SWITCHING ====================
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    tabPanes.forEach(p => {
      p.classList.remove('active');
      p.style.display = 'none';
    });

    btn.classList.add('active');
    const targetId = btn.getAttribute('data-tab');
    const targetPane = document.getElementById(targetId);
    if (targetPane) {
      targetPane.classList.add('active');
      targetPane.style.display = 'block';
    }

    if (targetId === 'tab-releases') {
      fetchReleases();
    } else if (targetId === 'tab-emails') {
      fetchEmailLogs();
    }
  });
});

function switchToTab(tabId) {
  const btn = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
  if (btn) btn.click();
}

// ==================== TOAST SYSTEM ====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==================== FILE DRAG & DROP ====================
apkFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    handleFileSelect(e.target.files[0]);
  }
});

['dragenter', 'dragover'].forEach(eventName => {
  apkDropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    apkDropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  apkDropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    apkDropzone.classList.remove('dragover');
  });
});

apkDropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleFileSelect(e.dataTransfer.files[0]);
  }
});

function handleFileSelect(file) {
  if (!file.name.toLowerCase().endsWith('.apk')) {
    showToast('请上传标准的 Android 安装包 (.apk 文件)', 'error');
    return;
  }

  selectedFile = file;
  displayFileName.textContent = file.name;
  displayFileSize.textContent = formatBytes(file.size);
  selectedFileBox.style.display = 'flex';
  apkDropzone.style.display = 'none';

  // Automatically guess version if filename has version numbers
  const match = file.name.match(/v?(\d+\.\d+\.\d+)/i);
  if (match && !inputVersion.value) {
    inputVersion.value = `v${match[1]}`;
  }
}

btnRemoveFile.addEventListener('click', () => {
  selectedFile = null;
  apkFileInput.value = '';
  selectedFileBox.style.display = 'none';
  apkDropzone.style.display = 'block';
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

// ==================== UPLOAD & AUTO RELEASE ====================
async function handleUploadAndRelease() {
  const versionVal = inputVersion.value.trim();
  const channelVal = inputChannel.value;
  const changelogVal = inputChangelog.value.trim();
  const sendEmailCheckbox = document.getElementById('input-send-email');
  const sendEmail = sendEmailCheckbox ? sendEmailCheckbox.checked : false;

  const formData = new FormData();
  if (selectedFile) {
    formData.append('apkFile', selectedFile);
  } else {
    showToast('未选择外部 APK，将自动使用内置 sample-debug.apk 发版', 'info');
  }

  formData.append('version', versionVal);
  formData.append('channel', channelVal);
  formData.append('changelog', changelogVal);
  formData.append('sendEmail', sendEmail ? 'true' : 'false');

  // Disable UI and show progress
  btnSubmitUpload.disabled = true;
  uploadProgressContainer.style.display = 'block';
  progressStatusText.style.display = 'block';
  uploadProgressBar.style.width = '20%';
  progressStatusText.textContent = '正在打包并同步 Git Tag 推送至 GitHub...';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/releases/upload', true);

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      const percent = Math.min(85, Math.round((event.loaded / event.total) * 85));
      uploadProgressBar.style.width = `${percent}%`;
      progressStatusText.textContent = `正在传输数据 (${percent}%)...`;
    }
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      uploadProgressBar.style.width = '100%';
      progressStatusText.textContent = '发布完成！Git 标签已就绪！';

      try {
        const response = JSON.parse(xhr.responseText);
        const newRelease = response.data.release;
        const gitResult = response.data.gitResult;

        let successMsg = `🎉 成功生成版本 ${newRelease.gitTag || newRelease.releaseName}！`;
        if (gitResult && gitResult.success) {
          successMsg += ' 已推送到 GitHub 远端！';
        }
        showToast(successMsg, 'success');

        // Reset Form
        selectedFile = null;
        if (apkFileInput) apkFileInput.value = '';
        selectedFileBox.style.display = 'none';
        apkDropzone.style.display = 'block';
        inputVersion.value = '';
        inputChangelog.value = '';

        setTimeout(() => {
          uploadProgressContainer.style.display = 'none';
          progressStatusText.style.display = 'none';
          btnSubmitUpload.disabled = false;

          // Switch to release list and refresh
          fetchReleases();
          switchToTab('tab-releases');

          if (sendEmail && newRelease.emailNotification) {
            openEmailModal(newRelease);
          }
        }, 600);
      } catch (err) {
        showToast('响应解析异常: ' + err.message, 'error');
        resetUploadProgress();
      }
    } else {
      let errorMsg = '上传失败';
      try {
        const res = JSON.parse(xhr.responseText);
        errorMsg = res.message || errorMsg;
      } catch (_) {}
      showToast(errorMsg, 'error');
      resetUploadProgress();
    }
  };

  xhr.onerror = () => {
    showToast('网络通信异常，请重试', 'error');
    resetUploadProgress();
  };

  xhr.send(formData);
}

// Bind both button click and form submit
if (btnSubmitUpload) {
  btnSubmitUpload.addEventListener('click', (e) => {
    e.preventDefault();
    handleUploadAndRelease();
  });
}

if (uploadForm) {
  uploadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleUploadAndRelease();
  });
}

function resetUploadProgress() {
  btnSubmitUpload.disabled = false;
  uploadProgressContainer.style.display = 'none';
  progressStatusText.style.display = 'none';
  uploadProgressBar.style.width = '0%';
}

// ==================== FETCH & RENDER RELEASES ====================
async function fetchReleases() {
  try {
    const res = await fetch('/api/releases');
    const result = await res.json();
    if (result.code === 0) {
      currentReleases = result.data.releases || [];
      currentEmailSettings = result.data.emailSettings || {};

      // Update Stats
      statNextRelease.textContent = result.data.nextReleaseName;
      badgeNextName.textContent = result.data.nextReleaseName;
      statTotalReleases.textContent = currentReleases.length;

      let totalBytes = 0;
      let emailSentCount = 0;
      currentReleases.forEach(r => {
        totalBytes += r.fileSize || 0;
        if (r.emailStatus === 'sent') emailSentCount++;
      });

      statStorageSize.textContent = formatBytes(totalBytes);
      statEmailCount.textContent = `${emailSentCount} 次`;

      // Pre-fill email defaults if not manually edited
      if (inputRecipients && !inputRecipients.value && currentEmailSettings.defaultRecipients) {
        inputRecipients.value = currentEmailSettings.defaultRecipients;
      }

      // Sync settings fields
      if (settingSenderName) settingSenderName.value = currentEmailSettings.senderName || '';
      if (settingSenderEmail) settingSenderEmail.value = currentEmailSettings.senderEmail || '';
      if (settingDefaultRecipients) settingDefaultRecipients.value = currentEmailSettings.defaultRecipients || '';
      if (settingSubjectTemplate) settingSubjectTemplate.value = currentEmailSettings.emailSubjectTemplate || '';

      renderReleaseTable(currentReleases);
    }
  } catch (err) {
    console.error('Failed to fetch releases:', err);
  }
}

function renderReleaseTable(releases) {
  if (!releaseTableBody) return;
  const query = searchReleaseInput ? searchReleaseInput.value.trim().toLowerCase() : '';
  const filtered = (releases || []).filter(r => {
    if (!query) return true;
    return (
      (r.releaseName && r.releaseName.toLowerCase().includes(query)) ||
      (r.version && r.version.toLowerCase().includes(query)) ||
      (r.originalFileName && r.originalFileName.toLowerCase().includes(query)) ||
      (r.changelog && r.changelog.toLowerCase().includes(query))
    );
  });

  if (filtered.length === 0) {
    releaseTableBody.innerHTML = '';
    if (releasesEmptyState) releasesEmptyState.style.display = 'block';
    return;
  }

  if (releasesEmptyState) releasesEmptyState.style.display = 'none';

  releaseTableBody.innerHTML = filtered.map(item => {
    const timeFormatted = item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }) : '-';

    const isEmailSent = item.emailStatus === 'sent';
    const md5Str = item.md5 || '';
    const md5Short = md5Str.length > 10 ? `${md5Str.substring(0, 10)}...` : (md5Str || '-');

    return `
      <tr>
        <td>
          <div class="badge-release">
            <span>🏷️</span>
            <span>${item.releaseName}</span>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; color: var(--slate-900);">${item.version || '-'}</div>
          <div style="font-size: 11px; color: var(--slate-500);">${item.channel || '官方发布'}</div>
        </td>
        <td>
          <div style="font-weight: 500; color: var(--slate-800);" title="${item.originalFileName}">${truncate(item.originalFileName, 24)}</div>
          <div style="font-size: 11px; color: var(--slate-500);">${item.fileSizeFormatted}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 4px;">
            <code style="font-size: 11px; background: var(--slate-100); padding: 2px 6px; border-radius: 4px; color: var(--slate-700);" title="${md5Str}">${md5Short}</code>
            <button class="btn-action" style="padding: 2px 6px; font-size: 10px;" onclick="copyText('${md5Str}')" title="复制完整 MD5">📋</button>
          </div>
        </td>
        <td>
          <div style="font-size: 12px; color: var(--slate-600);">${timeFormatted}</div>
        </td>
        <td>
          <span class="badge-email-sent" onclick="viewReleaseEmail(${item.id})" title="点击查看邮件通知内容">
            <span>✉️</span>
            <span>${isEmailSent ? '已通知' : '未通知'}</span>
          </span>
        </td>
        <td style="text-align: right;">
          <div class="actions-cell" style="justify-content: flex-end;">
            <a href="/api/releases/${item.id}/download" class="btn-action download" title="直接下载该 APK 包">
              <span>📥 下载</span>
            </a>
            <button class="btn-action" onclick="viewReleaseEmail(${item.id})" title="查看或重发通知邮件">
              <span>✉️ 邮件</span>
            </button>
            <button class="btn-action danger" onclick="deleteRelease(${item.id}, '${item.releaseName}')" title="删除该包">
              <span>🗑️</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

searchReleaseInput.addEventListener('input', () => {
  renderReleaseTable(currentReleases);
});

btnRefreshReleases.addEventListener('click', () => {
  fetchReleases();
  showToast('列表已刷新', 'info');
});

// ==================== DELETE RELEASE ====================
window.deleteRelease = async (id, releaseName) => {
  if (!confirm(`确定要删除 ${releaseName} 吗？相关的 APK 包文件也将被移除。`)) return;

  try {
    const res = await fetch(`/api/releases/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.code === 0) {
      showToast(`已成功删除 ${releaseName}`, 'success');
      fetchReleases();
    } else {
      showToast(result.message || '删除失败', 'error');
    }
  } catch (err) {
    showToast('删除请求异常', 'error');
  }
};

// ==================== EMAIL NOTIFICATION MODAL & ACTIONS ====================
window.viewReleaseEmail = (id) => {
  const release = currentReleases.find(r => r.id === id);
  if (release) {
    openEmailModal(release);
  }
};

function openEmailModal(release) {
  currentSelectedReleaseForModal = release;
  modalReleaseName.textContent = release.releaseName;

  const subject = release.emailNotification?.subject || `【智驾云/AOT】新版本发布通知 - ${release.releaseName}`;
  const recipients = release.recipients?.join(', ') || '未配置';
  const sentTime = release.emailNotification?.sentAt
    ? new Date(release.emailNotification.sentAt).toLocaleString('zh-CN')
    : new Date(release.createdAt).toLocaleString('zh-CN');

  modalEmailSubject.textContent = subject;
  modalEmailRecipients.textContent = recipients;
  modalEmailTime.textContent = sentTime;

  // Render iframe content safely
  const previewHtml = release.emailNotification?.previewHtml || '<p>暂无邮件内容</p>';
  modalEmailIframe.srcdoc = previewHtml;

  emailPreviewModal.classList.add('open');
}

btnCloseEmailModal.addEventListener('click', () => {
  emailPreviewModal.classList.remove('open');
});

emailPreviewModal.addEventListener('click', (e) => {
  if (e.target === emailPreviewModal) {
    emailPreviewModal.classList.remove('open');
  }
});

btnCopyEmailHtml.addEventListener('click', () => {
  if (!currentSelectedReleaseForModal || !currentSelectedReleaseForModal.emailNotification?.previewHtml) {
    showToast('没有可复制的邮件内容', 'error');
    return;
  }
  copyText(currentSelectedReleaseForModal.emailNotification.previewHtml);
  showToast('邮件 HTML 内容已成功复制到剪贴板', 'success');
});

btnResendCurrentEmail.addEventListener('click', async () => {
  if (!currentSelectedReleaseForModal) return;

  btnResendCurrentEmail.disabled = true;
  btnResendCurrentEmail.textContent = '正在重新派发...';

  try {
    const res = await fetch(`/api/releases/${currentSelectedReleaseForModal.id}/resend-email`, {
      method: 'POST'
    });
    const result = await res.json();
    if (result.code === 0) {
      showToast(`已向相关人员重新发送 ${currentSelectedReleaseForModal.releaseName} 邮件通知`, 'success');
      fetchReleases();
      fetchEmailLogs();
      emailPreviewModal.classList.remove('open');
    } else {
      showToast(result.message || '发送失败', 'error');
    }
  } catch (err) {
    showToast('派发请求失败', 'error');
  } finally {
    btnResendCurrentEmail.disabled = false;
    btnResendCurrentEmail.textContent = '📤 重新推送邮件';
  }
});

// ==================== EMAIL SETTINGS & LOGS ====================
btnSaveEmailSettings.addEventListener('click', async () => {
  const payload = {
    senderName: settingSenderName.value.trim(),
    senderEmail: settingSenderEmail.value.trim(),
    defaultRecipients: settingDefaultRecipients.value.trim(),
    emailSubjectTemplate: settingSubjectTemplate.value.trim()
  };

  try {
    const res = await fetch('/api/email/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.code === 0) {
      showToast('邮件通知规则设置已保存', 'success');
      currentEmailSettings = result.data;
    } else {
      showToast(result.message || '保存失败', 'error');
    }
  } catch (err) {
    showToast('保存配置异常', 'error');
  }
});

async function fetchEmailLogs() {
  try {
    const res = await fetch('/api/email/logs');
    const result = await res.json();
    if (result.code === 0) {
      renderEmailLogs(result.data || []);
    }
  } catch (err) {
    console.error('Failed to fetch email logs:', err);
  }
}

function renderEmailLogs(logs) {
  if (logs.length === 0) {
    emailLogsContainer.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--slate-400);">
        暂无邮件发送记录，推送并生成 release 后将自动记录
      </div>
    `;
    return;
  }

  emailLogsContainer.innerHTML = logs.map(log => {
    const timeFormatted = new Date(log.sentAt).toLocaleString('zh-CN');
    return `
      <div class="log-item">
        <div class="log-info">
          <div class="log-title">
            <span style="color: #2563eb; font-weight: 700;">[${log.releaseName}]</span>
            <span>${escapeHtml(log.subject)}</span>
          </div>
          <div class="log-meta">
            <span>📮 接收人: ${escapeHtml(log.recipients.join(', '))}</span>
            <span style="margin: 0 8px;">|</span>
            <span>🕒 ${timeFormatted}</span>
            <span style="margin: 0 8px;">|</span>
            <span style="color: #059669; font-weight: 600;">✓ 触发成功</span>
          </div>
        </div>
        <div>
          <button class="btn-action" onclick="previewLogEmail('${log.id}')">🔍 查看投递卡片</button>
        </div>
      </div>
    `;
  }).join('');
}

window.previewLogEmail = async (logId) => {
  const res = await fetch('/api/email/logs');
  const result = await res.json();
  const logs = result.data || [];
  const log = logs.find(l => l.id === logId);
  if (log) {
    currentSelectedReleaseForModal = {
      id: log.releaseId,
      releaseName: log.releaseName,
      recipients: log.recipients,
      emailNotification: {
        subject: log.subject,
        sentAt: log.sentAt,
        previewHtml: log.html
      }
    };
    openEmailModal(currentSelectedReleaseForModal);
  }
};

window.copyText = (text) => {
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板', 'info');
  }).catch(() => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('已复制到剪贴板', 'info');
  });
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Initial Load
fetchReleases();

// ==================== GITHUB RELEASE & MONITOR LOGIC ====================
const ghInputPackage = document.getElementById('gh-input-package');
const ghInputVersion = document.getElementById('gh-input-version');
const ghDisplayAssetName = document.getElementById('gh-display-asset-name');
const ghApkDropzone = document.getElementById('gh-apk-dropzone');
const ghApkFileInput = document.getElementById('gh-apk-file-input');
const ghDropText = document.getElementById('gh-drop-text');
const ghReleaseForm = document.getElementById('gh-release-form');
const btnGhDryrun = document.getElementById('btn-gh-dryrun');
const btnGhSubmit = document.getElementById('btn-gh-submit');
const ghReleaseResult = document.getElementById('gh-release-result');

let selectedGhFile = null;

function updateExpectedAssetName() {
  if (!ghInputPackage || !ghInputVersion || !ghDisplayAssetName) return;
  const pkg = ghInputPackage.value.trim() || 'com.zhijiayun.aot';
  const ver = (ghInputVersion.value.trim() || '1.0.0').replace(/^v/, '');
  ghDisplayAssetName.value = `${pkg}-v${ver}.apk`;
}

if (ghInputPackage) ghInputPackage.addEventListener('input', updateExpectedAssetName);
if (ghInputVersion) ghInputVersion.addEventListener('input', updateExpectedAssetName);

// File drag & drop
if (ghApkDropzone && ghApkFileInput) {
  ghApkDropzone.addEventListener('click', () => ghApkFileInput.click());
  ghApkFileInput.addEventListener('change', e => {
    if (e.target.files.length > 0) {
      selectedGhFile = e.target.files[0];
      ghDropText.innerHTML = `✅ 已选择文件: <strong>${escapeHtml(selectedGhFile.name)}</strong> (${(selectedGhFile.size / 1024 / 1024).toFixed(2)} MB)`;
    }
  });

  ['dragenter', 'dragover'].forEach(name => {
    ghApkDropzone.addEventListener(name, e => {
      e.preventDefault();
      ghApkDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    ghApkDropzone.addEventListener(name, e => {
      e.preventDefault();
      ghApkDropzone.classList.remove('dragover');
    });
  });

  ghApkDropzone.addEventListener('drop', e => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      selectedGhFile = e.dataTransfer.files[0];
      ghDropText.innerHTML = `✅ 已拖拽载入: <strong>${escapeHtml(selectedGhFile.name)}</strong> (${(selectedGhFile.size / 1024 / 1024).toFixed(2)} MB)`;
    }
  });
}

async function doGitHubRelease(isDryRun = false) {
  const repo = document.getElementById('gh-input-repo').value.trim();
  const pkg = document.getElementById('gh-input-package').value.trim();
  const ver = document.getElementById('gh-input-version').value.trim();
  const appName = document.getElementById('gh-input-appname').value.trim();
  const type = document.getElementById('gh-input-type').value;
  const changelog = document.getElementById('gh-input-changelog').value.trim();
  const token = document.getElementById('gh-input-token').value.trim();

  if (!ver) {
    showToast('必须提供版本号 (例如: 1.0.0)', 'error');
    if (ghInputVersion) ghInputVersion.focus();
    return;
  }

  const formData = new FormData();
  if (selectedGhFile) {
    formData.append('apk', selectedGhFile);
  }
  formData.append('repo', repo);
  formData.append('package', pkg);
  formData.append('version', ver);
  formData.append('appName', appName);
  formData.append('isPrerelease', type === 'prerelease' ? 'true' : 'false');
  formData.append('isLatest', type === 'latest' ? 'true' : 'false');
  formData.append('changelog', changelog);
  formData.append('token', token);
  formData.append('dryRun', isDryRun ? 'true' : 'false');

  const actionText = isDryRun ? 'Dry-run 模拟演练' : '发布到 GitHub';
  showToast(`正在执行 ${actionText}...`, 'info');

  try {
    const resp = await fetch('/api/github/release', {
      method: 'POST',
      body: formData
    });

    const res = await resp.json();
    if (res.code === 0) {
      showToast(res.message, 'success');
      renderGitHubReleaseResult(res.data, res.dryRun);
    } else {
      const errDetail = res.validationErrors && res.validationErrors.length > 0
        ? res.validationErrors.join('\n• ')
        : res.message;
      showToast(`发布校验失败: ${res.message}`, 'error');
      alert(`⚠️ 规范校验未通过:\n\n• ${errDetail}`);
    }
  } catch (err) {
    showToast(`网络请求异常: ${err.message}`, 'error');
  }
}

function renderGitHubReleaseResult(rel, isDryRun) {
  if (!ghReleaseResult) return;
  ghReleaseResult.style.display = 'block';

  const badgeColor = isDryRun ? '#e0f2fe' : '#dcfce7';
  const badgeTextColor = isDryRun ? '#0369a1' : '#15803d';
  const modeLabel = isDryRun ? '🔍 规范模拟校验 (Dry-run PASS)' : '🌐 GitHub 正式发布成功';

  ghReleaseResult.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <div style="font-weight: 700; font-size: 15px; color: var(--slate-900);">
        ${modeLabel}
      </div>
      <span style="background: ${badgeColor}; color: ${badgeTextColor}; padding: 3px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600;">
        Tag: ${escapeHtml(rel.tag)}
      </span>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px; color: var(--slate-700); background: #fff; padding: 14px; border-radius: 6px; border: 1px solid #e2e8f0;">
      <div><strong>目标仓库：</strong><a href="https://github.com/${escapeHtml(rel.repo)}" target="_blank" style="color: #2563eb;">${escapeHtml(rel.repo)}</a></div>
      <div><strong>版本号：</strong>${escapeHtml(rel.version)}</div>
      <div><strong>应用包名：</strong>${escapeHtml(rel.packageName)}</div>
      <div><strong>发布类型：</strong>${rel.isPrerelease ? '🧪 Pre-release (测试版)' : '🚀 Latest (正式版)'}</div>
      <div><strong>Asset 文件：</strong>${escapeHtml(rel.asset.name)}</div>
      <div><strong>包体大小：</strong>${(rel.asset.size / 1024).toFixed(1)} KB</div>
      <div style="grid-column: 1 / -1;"><strong>MD5 校验：</strong><code>${rel.asset.md5}</code></div>
      <div style="grid-column: 1 / -1;"><strong>下载直链：</strong><a href="${escapeHtml(rel.asset.downloadUrl)}" target="_blank" style="color: #2563eb; word-break: break-all;">${escapeHtml(rel.asset.downloadUrl)}</a></div>
    </div>
    <div style="margin-top: 12px; font-size: 12px; color: var(--slate-500);">
      👉 门市设备在「云端 App 下载」已可检测到该版本，并将在更新对话框中拉取该版本的更新日志。
    </div>
  `;
}

if (ghReleaseForm) {
  ghReleaseForm.addEventListener('submit', e => {
    e.preventDefault();
    doGitHubRelease(false);
  });
}

if (btnGhDryrun) {
  btnGhDryrun.addEventListener('click', () => {
    doGitHubRelease(true);
  });
}

// ==================== MONITOR CHECK UPDATE LOGIC ====================
const btnMonitorCheck = document.getElementById('btn-monitor-check');
const monitorInputRepo = document.getElementById('monitor-input-repo');
const monitorInputCurrentVer = document.getElementById('monitor-input-current-ver');
const monitorDisplayArea = document.getElementById('monitor-display-area');

if (btnMonitorCheck) {
  btnMonitorCheck.addEventListener('click', async () => {
    const repo = monitorInputRepo.value.trim() || 'ZJaCloud/aot-release-apk';
    const currentVersion = monitorInputCurrentVer.value.trim() || 'v1.0.0';

    monitorDisplayArea.innerHTML = `
      <div style="text-align: center; color: var(--slate-600); padding: 30px;">
        <div class="spinner" style="margin: 0 auto 12px auto; width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div>正在连线 GitHub 检查 ${escapeHtml(repo)} 的最新发布版本...</div>
      </div>
    `;

    try {
      const resp = await fetch(`/api/github/check-update?repo=${encodeURIComponent(repo)}&currentVersion=${encodeURIComponent(currentVersion)}`);
      const res = await resp.json();

      if (res.code === 0) {
        const info = res.data;
        renderMonitorDialog(info);
      } else {
        monitorDisplayArea.innerHTML = `
          <div style="text-align: center; color: #dc2626; padding: 24px;">
            <div style="font-size: 32px; margin-bottom: 8px;">⚠️</div>
            <div style="font-weight: 600;">更新检查失败</div>
            <div style="font-size: 13px; margin-top: 4px;">${escapeHtml(res.message)}</div>
          </div>
        `;
      }
    } catch (err) {
      monitorDisplayArea.innerHTML = `
        <div style="text-align: center; color: #dc2626; padding: 24px;">
          <div style="font-size: 32px; margin-bottom: 8px;">❌</div>
          <div>网络通讯异常: ${escapeHtml(err.message)}</div>
        </div>
      `;
    }
  });
}

function renderMonitorDialog(info) {
  if (!monitorDisplayArea) return;

  if (info.error) {
    monitorDisplayArea.innerHTML = `
      <div style="text-align: center; color: #dc2626; padding: 24px;">
        <div style="font-size: 32px; margin-bottom: 8px;">⚠️</div>
        <div style="font-weight: 600;">监控器查询未成功</div>
        <div style="font-size: 13px; margin-top: 4px; color: #64748b;">${escapeHtml(info.error)}</div>
        <div style="font-size: 12px; margin-top: 8px; color: #94a3b8;">💡 提示：若仓库为公开仓库且暂无正式版 Release，请先在【GitHub 规范发布】中创建首发版本。</div>
      </div>
    `;
    return;
  }

  if (!info.hasUpdate) {
    monitorDisplayArea.innerHTML = `
      <div style="text-align: center; color: #166534; padding: 30px;">
        <div style="font-size: 40px; margin-bottom: 10px;">🎉</div>
        <div style="font-size: 16px; font-weight: 700; color: #15803d;">当前设备已是最新版本！</div>
        <div style="font-size: 13px; color: #475569; margin-top: 6px;">
          当前已安装版本：<code>${escapeHtml(info.currentVersion)}</code> | 远端最新正式版：<code>${escapeHtml(info.latestTag || '暂无')}</code>
        </div>
      </div>
    `;
    return;
  }

  // 模拟门市更新对话框
  const apkDownloadUrl = info.asset ? info.asset.downloadUrl : '#';
  const apkSizeText = info.asset ? `${(info.asset.size / 1024 / 1024).toFixed(2)} MB` : '未知大小';

  monitorDisplayArea.innerHTML = `
    <div style="width: 100%; max-width: 520px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1); overflow: hidden;">
      <!-- 对话框头部 -->
      <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 18px 22px; color: #fff; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 16px; font-weight: 700;">🚀 发现新版本更新</div>
          <div style="font-size: 12px; opacity: 0.9; margin-top: 2px;">门市「云端 App 下载」自动推送</div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.2); padding: 3px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600;">
          ${escapeHtml(info.latestTag)}
        </div>
      </div>

      <!-- 对话框主体内容 (渲染 Release 说明 Body) -->
      <div style="padding: 20px; max-height: 280px; overflow-y: auto;">
        <div style="font-size: 12px; color: #64748b; margin-bottom: 10px; display: flex; justify-content: space-between;">
          <span>当前版本: <strong>${escapeHtml(info.currentVersion)}</strong></span>
          <span>目标版本: <strong style="color: #2563eb;">${escapeHtml(info.latestTag)}</strong></span>
        </div>
        <div style="background: #f8fafc; border: 1px solid #edf2f7; border-radius: 8px; padding: 14px; font-size: 13px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">
${escapeHtml(info.body || '常规体验升级与缺陷修复。')}
        </div>
      </div>

      <!-- 对话框底部操作栏 -->
      <div style="padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
        <div style="font-size: 12px; color: #64748b;">
          安装包大小: <strong>${apkSizeText}</strong>
        </div>
        <a href="${escapeHtml(apkDownloadUrl)}" class="btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 13px;" target="_blank">
          📥 立即下载并覆盖安装
        </a>
      </div>
    </div>
  `;
}
