import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export const GITHUB_REPO = 'ZJaCloud/aot-release-apk';
export const SSH_REMOTE_URL = 'git@github.com:ZJaCloud/aot-release-apk.git';

/**
 * 确保工作区 Git 已初始化且配置了正确的 SSH 远端地址
 */
export async function ensureGitConfig() {
  try {
    await execAsync('git status', { cwd: ROOT_DIR });
  } catch (err) {
    // 未初始化则初始化
    await execAsync('git init && git branch -M main', { cwd: ROOT_DIR });
  }

  try {
    const { stdout } = await execAsync('git remote -v', { cwd: ROOT_DIR });
    if (!stdout.includes('origin')) {
      await execAsync(`git remote add origin ${SSH_REMOTE_URL}`, { cwd: ROOT_DIR });
    } else if (!stdout.includes(SSH_REMOTE_URL)) {
      await execAsync(`git remote set-url origin ${SSH_REMOTE_URL}`, { cwd: ROOT_DIR });
    }
  } catch (err) {
    console.warn(`[Git Config Warning]: ${err.message}`);
  }
}

/**
 * 创建 Git Tag 并通过 SSH 推送到 GitHub 仓库 (git@github.com:ZJaCloud/aot-release-apk.git)
 */
export async function pushGitTag({ tag, message = '', remote = 'origin' }) {
  await ensureGitConfig();

  const safeTag = tag.trim().startsWith('v') ? tag.trim() : `v${tag.trim()}`;
  const safeMsg = (message || `Release ${safeTag}`).replace(/"/g, '\\"');

  // 1. 本地创建 Tag (如果已存在则覆盖或复用)
  try {
    await execAsync(`git tag -a ${safeTag} -m "${safeMsg}"`, { cwd: ROOT_DIR });
  } catch (err) {
    if (err.message.includes('already exists')) {
      // 强制更新标签以指向当前提交
      await execAsync(`git tag -a -f ${safeTag} -m "${safeMsg}"`, { cwd: ROOT_DIR });
    } else {
      console.warn(`[Git Tag Creation]: ${err.message}`);
    }
  }

  // 2. 通过 SSH 推送 Tag 到 GitHub 远端
  try {
    const { stdout, stderr } = await execAsync(`git push ${remote} ${safeTag}`, {
      cwd: ROOT_DIR,
      timeout: 20000 // 20 秒超时
    });
    return {
      success: true,
      tag: safeTag,
      remoteUrl: `https://github.com/${GITHUB_REPO}`,
      releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${safeTag}`,
      message: `🎉 Git Tag ${safeTag} 已成功通过 SSH 推送到 GitHub (${SSH_REMOTE_URL})！`,
      stdout,
      stderr
    };
  } catch (pushErr) {
    console.warn(`[Git SSH Push Warning]: ${pushErr.message}`);
    return {
      success: false,
      tag: safeTag,
      remoteUrl: `https://github.com/${GITHUB_REPO}`,
      releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${safeTag}`,
      message: `本地 Tag ${safeTag} 已生成。SSH 推送提示: ${pushErr.message}`,
      error: pushErr.message
    };
  }
}
