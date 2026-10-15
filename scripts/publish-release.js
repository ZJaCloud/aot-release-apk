#!/usr/bin/env node

/**
 * CLI 命令行工具：符合第三方发布规范的 GitHub Release 自动化发布脚本
 * 用法示例：
 *   node scripts/publish-release.js --apk sample-debug.apk --version 1.0.0 --package com.zhijiayun.aot --changelog "1. 修复已知问题" --latest --dry-run
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createGitHubRelease,
  DEFAULT_REPO,
  DEFAULT_PACKAGE_NAME
} from '../services/githubReleaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArgs(args) {
  const params = {
    apk: path.join(ROOT_DIR, 'sample-debug.apk'),
    version: '',
    package: DEFAULT_PACKAGE_NAME,
    repo: DEFAULT_REPO,
    appName: '智驾云 AOT 客户端',
    changelog: '',
    latest: false,
    prerelease: false,
    dryRun: false,
    token: process.env.GITHUB_TOKEN || ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apk' && args[i + 1]) {
      params.apk = path.resolve(process.cwd(), args[++i]);
    } else if (arg === '--version' && args[i + 1]) {
      params.version = args[++i];
    } else if (arg === '--package' && args[i + 1]) {
      params.package = args[++i];
    } else if (arg === '--repo' && args[i + 1]) {
      params.repo = args[++i];
    } else if (arg === '--app-name' && args[i + 1]) {
      params.appName = args[++i];
    } else if (arg === '--changelog' && args[i + 1]) {
      params.changelog = args[++i];
    } else if (arg === '--token' && args[i + 1]) {
      params.token = args[++i];
    } else if (arg === '--latest') {
      params.latest = true;
    } else if (arg === '--prerelease') {
      params.prerelease = true;
    } else if (arg === '--dry-run') {
      params.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // 默认如果未指定 prerelease，且未指定 latest，则提示或默认 latest
  if (!params.prerelease && !params.latest) {
    params.latest = true; // 默认作为正式版
  }

  return params;
}

function printHelp() {
  console.log(`
🚀 GitHub Release 规范自动化发布脚本 (AOT APK Release CLI)

使用说明:
  node scripts/publish-release.js [参数选项]

参数选项:
  --apk <path>          APK 文件物理路径 (默认使用工程内 sample-debug.apk)
  --version <version>   APK 版本号 (如 1.0.0 或 v1.0.0，必填)
  --package <pkgName>   Android packageName/applicationId (默认: ${DEFAULT_PACKAGE_NAME})
  --repo <owner/repo>   目标 GitHub 公开仓库 (默认: ${DEFAULT_REPO})
  --app-name <name>     门市显示名称 (默认: 智驾云 AOT 客户端)
  --changelog <text>    更新说明/Changelog，将写入 Release body 并在更新对话框展示
  --latest              标记为正式发布版 (Latest，不可与 --prerelease 混用)
  --prerelease          标记为测试版 (pre-release，绝不标为 Latest)
  --dry-run             本地模拟演练模式 (无需 GitHub Token，完整校验规则)
  --token <token>       GitHub Personal Access Token (亦可读取 GITHUB_TOKEN 环境变量)
  --help, -h            查看本帮助说明

示例:
  1. 本地演练校验 (Dry-run):
     node scripts/publish-release.js --version 1.0.0 --changelog "1. 首发正式版本" --latest --dry-run

  2. 真实线上发布 (需提供 Token):
     export GITHUB_TOKEN=ghp_xxxx
     node scripts/publish-release.js --apk ./app-release.apk --version 1.0.1 --changelog "修复定位偶发漂移" --latest
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('\n======================================================');
  console.log('📦 智驾云 · GitHub Release 规范发布自动化脚本启动');
  console.log('======================================================');

  if (!options.version) {
    console.error('❌ 错误：必须通过 --version 指定版本号 (例如: --version 1.0.0)');
    process.exit(1);
  }

  if (!fs.existsSync(options.apk)) {
    console.error(`❌ 错误：找不到指定的 APK 文件: ${options.apk}`);
    process.exit(1);
  }

  const cleanVer = options.version.replace(/^v/, '');
  const tag = `v${cleanVer}`;

  console.log(`📌 目标仓库:   ${options.repo}`);
  console.log(`🏷️ 发布 Tag:    ${tag} (与 APK versionName 一致)`);
  console.log(`📦 应用包名:   ${options.package}`);
  console.log(`📱 门市显示名: ${options.appName}`);
  console.log(`✨ 发布类型:   ${options.prerelease ? '🧪 测试版 (Pre-release)' : '🚀 正式版 (Latest)'}`);
  console.log(`📁 物理 APK:   ${options.apk}`);
  console.log(`⚙️ 运行模式:   ${options.dryRun || !options.token ? '🔍 Dry-run 演练模式' : '🌐 真实 GitHub API 发布'}`);
  console.log('------------------------------------------------------');

  try {
    const result = await createGitHubRelease({
      repo: options.repo,
      tag: tag,
      versionName: cleanVer,
      packageName: options.package,
      appName: options.appName,
      changelog: options.changelog || '常规优化及已知缺陷修复。',
      isPrerelease: options.prerelease,
      isLatest: options.latest,
      apkFilePath: options.apk,
      token: options.token,
      dryRun: options.dryRun
    });

    console.log(`\n🎉 【发布成功】${result.message}`);
    console.log(`   - Release 页面:   ${result.release.htmlUrl}`);
    console.log(`   - Tag 标识:       ${result.release.tag}`);
    console.log(`   - APK 资产名称:   ${result.release.asset.name}`);
    console.log(`   - APK 文件大小:   ${result.release.asset.size} bytes`);
    console.log(`   - APK MD5 哈希:   ${result.release.asset.md5}`);
    console.log(`   - 门市下载直链:   ${result.release.asset.downloadUrl}`);
    console.log('======================================================\n');
  } catch (err) {
    console.error(`\n❌ 【发布失败】: ${err.message}\n`);
    process.exit(1);
  }
}

main();
