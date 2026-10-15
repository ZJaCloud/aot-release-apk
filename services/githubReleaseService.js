import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 第三方发布规范核心常量与默认值 (对齐 TPOS 门市环境)
 */
export const DEFAULT_REPO = 'ZJaCloud/aot-release-apk';
export const DEFAULT_PACKAGE_NAME = 'com.sunmi.sm3xr4ap.restaurant_desktop'; // TPOS 真实包名
export const DEFAULT_APP_NAME = 'TPOS 餐厅收银桌面端';

/**
 * 语义化版本号比较 (支持 v/V 前缀)
 * 返回: 1 表示 v1 > v2; -1 表示 v1 < v2; 0 表示相等
 */
export function compareSemver(v1, v2) {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;

  const clean1 = String(v1).trim().replace(/^[vV]/, '');
  const clean2 = String(v2).trim().replace(/^[vV]/, '');

  const parts1 = clean1.split('.').map(x => parseInt(x, 10) || 0);
  const parts2 = clean2.split('.').map(x => parseInt(x, 10) || 0);

  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * 校验发布规范 (严格遵循第三方 4 大发布约定与基础要素)
 * 1. Tag: 必须为 vX.Y.Z 且严格与 APK 的 versionName 一致
 * 2. Asset: 必须至少附带一个 .apk，命名建议 {packageName}-{version}.apk 或 app-release.apk
 * 3. Latest: 正式版才标记为 Latest；测试版标记为 pre-release，严禁标记为 Latest
 * 4. Release 描述: 写入 body，供门市在更新对话框展示
 */
export function validateReleaseSpec({ repo, tag, versionName, packageName, isPrerelease, isLatest, body, apkFileName, fileBuffer }) {
  const errors = [];

  // 1. Repo 检查
  if (!repo || !repo.includes('/') || repo.split('/').length !== 2) {
    errors.push(`GitHub 仓库格式必须为 owner/repo (例如: ${DEFAULT_REPO})，当前为: ${repo}`);
  }

  // 2. PackageName 检查
  if (!packageName || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName)) {
    errors.push(`Android packageName (applicationId) 格式不合法，当前为: ${packageName}`);
  }

  // 3. Tag 检查：必须形如 vX.Y.Z
  const tagRegex = /^v\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
  if (!tag || !tagRegex.test(tag)) {
    errors.push(`Tag 必须严格采用 vX.Y.Z 语义化版本格式 (如 v1.0.0)，当前为: ${tag}`);
  }

  // 4. versionName 与 Tag 一致性检查
  const cleanVersion = (versionName || '').trim().replace(/^v/, '');
  const cleanTagVersion = (tag || '').trim().replace(/^v/, '');
  if (!cleanVersion) {
    errors.push('必须提供 APK 的 versionName');
  } else if (cleanVersion !== cleanTagVersion) {
    errors.push(`Tag 版本号 (${cleanTagVersion}) 必须与 APK 的 versionName (${cleanVersion}) 严格保持一致`);
  }

  // 5. Asset 检查：必须是 .apk 文件
  if (!apkFileName || !apkFileName.toLowerCase().endsWith('.apk')) {
    errors.push(`Release 产物必须包含有效的 .apk 文件，当前文件名为: ${apkFileName}`);
  }

  // 6. Latest 与 Pre-release 互斥检查 (正式版才标 Latest，测试版标 pre-release 不要当 Latest)
  if (isPrerelease && isLatest) {
    errors.push('发布约定冲突：测试版已标记为 pre-release，严禁同时标记为 Latest！');
  }

  // 7. Release 说明检查
  if (!body || body.trim().length === 0) {
    errors.push('必须在 Release 说明 (body) 中填写版本更新日志，该内容将直接展示在门市更新对话框中');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 格式化 Asset 文件名
 * 规范：建议 {packageName}-{version}.apk 或 app-release.apk
 */
export function formatAssetFileName(packageName, version, preferredName) {
  if (preferredName && (preferredName === 'app-release.apk' || preferredName.endsWith('.apk'))) {
    return preferredName;
  }
  const cleanVer = (version || '').trim().replace(/^v/, '');
  const cleanPkg = (packageName || DEFAULT_PACKAGE_NAME).trim();
  return `${cleanPkg}-v${cleanVer}.apk`;
}

/**
 * 构建符合更新对话框展示的 Release 说明 (body)
 */
export function formatReleaseBody({ changelog, appName = '智驾云 AOT 客户端', packageName, versionName, isPrerelease }) {
  const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const typeBadge = isPrerelease ? '🧪 内部/测试版 (Pre-release)' : '🚀 生产/正式版 (Latest)';

  return `## 📱 ${appName} 更新说明

- **发布类型**：${typeBadge}
- **应用包名**：\`${packageName}\`
- **版本号**：\`v${versionName.replace(/^v/, '')}\`
- **发布时间**：${dateStr}

---

### 📝 更新日志 (Changelog)
${changelog ? changelog.trim() : '常规体验优化与缺陷修复。'}

---
> 💡 *门市车机更新提示：此更新由门市「云端 App 下载」自动推送，签名一致可直接平滑覆盖安装。*`;
}

/**
 * 调用 GitHub REST API 创建 Release 并上传 APK Asset
 */
export async function createGitHubRelease(options) {
  const {
    repo = DEFAULT_REPO,
    tag,
    versionName,
    packageName = DEFAULT_PACKAGE_NAME,
    appName = '智驾云 AOT 客户端',
    changelog = '',
    isPrerelease = false,
    isLatest = true,
    apkFileName = 'app-release.apk',
    apkBuffer,
    apkFilePath,
    token = process.env.GITHUB_TOKEN || '',
    dryRun = false
  } = options;

  // 统一版本号与 Tag 格式
  const effectiveVersion = (versionName || '').trim().replace(/^v/, '');
  const effectiveTag = tag !== undefined && tag !== null && String(tag).trim() !== ''
    ? String(tag).trim()
    : (effectiveVersion ? `v${effectiveVersion}` : '');

  // 构建 body
  const body = options.body || formatReleaseBody({
    changelog,
    appName,
    packageName,
    versionName: effectiveVersion,
    isPrerelease
  });

  // 规范校验
  const validation = validateReleaseSpec({
    repo,
    tag: effectiveTag,
    versionName: effectiveVersion,
    packageName,
    isPrerelease,
    isLatest,
    body,
    apkFileName,
    fileBuffer: apkBuffer
  });

  if (!validation.valid) {
    const errorMsg = `Release 规范校验失败:\n - ${validation.errors.join('\n - ')}`;
    const err = new Error(errorMsg);
    err.validationErrors = validation.errors;
    throw err;
  }

  // 准备 APK Buffer 与 MD5
  let fileData = apkBuffer;
  if (!fileData && apkFilePath && fs.existsSync(apkFilePath)) {
    fileData = fs.readFileSync(apkFilePath);
  }
  if (!fileData || fileData.length === 0) {
    throw new Error('未提供有效的 APK 文件内容或物理文件不存在');
  }

  const fileMd5 = crypto.createHash('md5').update(fileData).digest('hex');
  const targetAssetName = formatAssetFileName(packageName, effectiveVersion);

  // Payload 构造
  const releasePayload = {
    tag_name: effectiveTag,
    target_commitish: 'main',
    name: `${appName} ${effectiveTag}`,
    body: body,
    draft: false,
    prerelease: isPrerelease,
    make_latest: isPrerelease ? "false" : (isLatest ? "true" : "false")
  };

  // ----------------- DRY-RUN 模拟模式 (用于本地测试与无 Token 场景) -----------------
  if (dryRun || !token || token === 'dry-run') {
    const mockReleaseId = Math.floor(10000000 + Math.random() * 90000000);
    const mockHtmlUrl = `https://github.com/${repo}/releases/tag/${effectiveTag}`;
    const mockDownloadUrl = `https://github.com/${repo}/releases/download/${effectiveTag}/${targetAssetName}`;

    return {
      success: true,
      dryRun: true,
      mode: 'SIMULATION',
      message: '【Dry-run 演练成功】所有发布规范校验 100% 通过！',
      release: {
        id: mockReleaseId,
        repo,
        tag: effectiveTag,
        version: effectiveVersion,
        packageName,
        appName,
        isPrerelease,
        isLatest: !isPrerelease && isLatest,
        htmlUrl: mockHtmlUrl,
        body,
        asset: {
          name: targetAssetName,
          size: fileData.length,
          md5: fileMd5,
          downloadUrl: mockDownloadUrl
        },
        payload: releasePayload
      }
    };
  }

  // ----------------- 真实 GITHUB API 线上调用 -----------------
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'AOT-Release-Bot/1.0',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // 1. 创建 Release
  const createUrl = `https://api.github.com/repos/${repo}/releases`;
  const createResp = await fetch(createUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(releasePayload)
  });

  let releaseData = null;
  let releaseId = null;

  if (createResp.ok) {
    releaseData = await createResp.json();
    releaseId = releaseData.id;
  } else if (createResp.status === 422) {
    // Release 可能已经存在于该 Tag，尝试直接获取已存在的 Release
    const getUrl = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(effectiveTag)}`;
    const getResp = await fetch(getUrl, { headers });
    if (getResp.ok) {
      releaseData = await getResp.json();
      releaseId = releaseData.id;
      // 更新其 body 和 latest 状态
      await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(releasePayload)
      });
    } else {
      const errorText = await createResp.text();
      throw new Error(`GitHub 创建 Release 失败 (${createResp.status}): ${errorText}`);
    }
  } else {
    const errorText = await createResp.text();
    throw new Error(`GitHub 创建 Release 失败 (${createResp.status}): ${errorText}`);
  }

  // 2. 检查并删除已存在的同名 Asset (避免 422 already_exists)
  const listAssetsUrl = `https://api.github.com/repos/${repo}/releases/${releaseId}/assets`;
  try {
    const assetsResp = await fetch(listAssetsUrl, { headers });
    if (assetsResp.ok) {
      const existingAssets = await assetsResp.json();
      const duplicateAsset = existingAssets.find(a => a.name === targetAssetName);
      if (duplicateAsset) {
        await fetch(`https://api.github.com/repos/${repo}/releases/assets/${duplicateAsset.id}`, {
          method: 'DELETE',
          headers
        });
      }
    }
  } catch (_) {}

  // 3. 上传 Asset APK
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(targetAssetName)}`;
  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(fileData.length)
    },
    body: fileData
  });

  if (!uploadResp.ok) {
    const uploadErrorText = await uploadResp.text();
    throw new Error(`GitHub 上传 APK Asset 失败 (${uploadResp.status}): ${uploadErrorText}`);
  }

  const assetData = await uploadResp.json();

  return {
    success: true,
    dryRun: false,
    mode: 'PRODUCTION',
    message: `已成功发布 ${effectiveTag} 至 GitHub ${repo}！`,
    release: {
      id: releaseId,
      repo,
      tag: releaseData.tag_name,
      version: effectiveVersion,
      packageName,
      appName,
      isPrerelease: releaseData.prerelease,
      isLatest: !releaseData.prerelease,
      htmlUrl: releaseData.html_url,
      body: releaseData.body,
      asset: {
        id: assetData.id,
        name: assetData.name,
        size: assetData.size,
        md5: fileMd5,
        downloadUrl: assetData.browser_download_url
      }
    }
  };
}

/**
 * 模拟门市 / 车机 Monitor 检查 GitHub 上的最新版本
 * 判定规范 (参考 TPOS 门市环境)：
 * 1. 装置上已安装的 TPOS: 读取 packageName = com.sunmi.sm3xr4ap.restaurant_desktop 的 versionName
 * 2. GitHub 上的最新版: 打 https://api.github.com/repos/ZJaCloud/aot-release-apk/releases/latest
 *    用 Release 的 tag_name 当远端版本 (去掉前面的 v / V，例如 V2.14.5 -> 2.14.5)
 * 3. 语义化比对: 远端 > 已安装 -> 提示更新；若还未安装 TPOS -> 只要有 latest 就提示安装
 * 4. 跟文件名的关系: Tag 决定版本，.apk asset 用于下载安装，文件名本身不拿来比版本
 */
export async function checkLatestRelease({
  repo = DEFAULT_REPO,
  currentVersion = '',
  packageName = DEFAULT_PACKAGE_NAME,
  token = process.env.GITHUB_TOKEN || ''
}) {
  const isInstalled = Boolean(
    currentVersion &&
    currentVersion.trim() !== '' &&
    currentVersion.trim() !== '0' &&
    currentVersion.trim() !== '未安装' &&
    currentVersion.trim() !== 'not_installed'
  );
  const cleanCurrent = isInstalled ? currentVersion.trim().replace(/^[vV]/, '') : '';

  // 构造查询头
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'TPOS-Monitor/1.0',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token && token !== 'dry-run') {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      if (resp.status === 404) {
        return {
          repo,
          packageName,
          isInstalled,
          hasUpdate: false,
          currentVersion: isInstalled ? `v${cleanCurrent}` : '未安装',
          latestTag: null,
          message: `仓库 ${repo} 尚未发布任何标有 Latest 的正式版 Release`
        };
      }
      throw new Error(`查询最新 Release 失败 (${resp.status})`);
    }

    const latest = await resp.json();
    const latestTag = latest.tag_name || '';
    const cleanLatest = latestTag.replace(/^[vV]/, ''); // 去除前导 v / V (例如 V2.14.5 -> 2.14.5)

    // 比较规则:
    // 1. 若还未安装 TPOS -> 只要有 latest 就提示安装 (actionType = 'INSTALL')
    // 2. 语义化比对: 远端 > 已安装 -> 提示更新 (actionType = 'UPDATE')
    const isNewer = !isInstalled || compareSemver(cleanLatest, cleanCurrent) > 0;
    const hasUpdate = isNewer;
    const actionType = !isInstalled ? 'INSTALL' : (isNewer ? 'UPDATE' : 'LATEST');

    // 提取 APK asset (跟文件名无关，只要是 .apk 即可用来下载安装)
    const apkAsset = (latest.assets || []).find(a => a.name && a.name.endsWith('.apk')) || null;

    return {
      repo,
      packageName,
      isInstalled,
      hasUpdate,
      actionType,
      currentVersion: isInstalled ? `v${cleanCurrent}` : '未安装',
      latestTag: latestTag,
      latestVersion: cleanLatest,
      releaseName: latest.name,
      body: latest.body || '',
      publishedAt: latest.published_at,
      htmlUrl: latest.html_url,
      asset: apkAsset ? {
        name: apkAsset.name,
        size: apkAsset.size,
        downloadUrl: apkAsset.browser_download_url
      } : null
    };
  } catch (err) {
    return {
      repo,
      packageName,
      isInstalled,
      hasUpdate: false,
      currentVersion: isInstalled ? `v${cleanCurrent}` : '未安装',
      error: err.message
    };
  }
}
