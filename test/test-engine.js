import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStore,
  saveStore,
  createReleaseFromApk,
  resendReleaseEmail,
  deleteRelease
} from '../services/releaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTestSuite() {
  console.log('========================================================');
  console.log('🧪 启动 AOT APK Release 核心自动化打包与邮件通知验证测试');
  console.log('========================================================\n');

  // 1. Reset / initialize clean state for testing
  const initialStore = {
    nextId: 1,
    releases: [],
    emailSettings: {
      autoSendOnRelease: true,
      defaultRecipients: "qa-team@zhijiayun.com, dev-leads@zhijiayun.com, pm@zhijiayun.com",
      senderName: "智驾云 AOT 持续集成发布中心",
      senderEmail: "release-bot@zhijiayun.com",
      emailSubjectTemplate: "【智驾云/AOT】新版本发布通知 - {{releaseName}}"
    },
    emailLogs: []
  };
  saveStore(initialStore);

  // Test 1: Upload first APK -> Expected release-1
  console.log('▶️ [测试 1] 第一次推送上传 APK 文件...');
  const fakeApkBuffer1 = Buffer.from('PK\x03\x04MockBinaryApkFilePayloadNumber1ForAOTProject');
  const res1 = createReleaseFromApk({
    fileBuffer: fakeApkBuffer1,
    originalFileName: 'app-pilot-v1.0.apk',
    version: 'v1.0.0',
    channel: '智驾云·车机正式版',
    changelog: '1. AOT 智驾领航基础能力发布\n2. 车辆数据总线通信协议适配',
    recipients: 'qa@zhijiayun.com, dev-test@zhijiayun.com',
    host: 'localhost:3000'
  });

  const rel1 = res1.release;
  console.log(`  -> 生成 Release 包名: ${rel1.releaseName}`);
  console.log(`  -> MD5 校验码: ${rel1.md5}`);
  console.log(`  -> 文件大小: ${rel1.fileSizeFormatted}`);
  console.log(`  -> 邮件主题: ${res1.emailRecord.subject}`);
  console.log(`  -> 邮件通知状态: ${rel1.emailStatus}`);

  if (rel1.releaseName !== 'release-1') {
    throw new Error(`❌ 测试 1 失败：期望包名为 release-1，但生成了 ${rel1.releaseName}`);
  }
  if (!fs.existsSync(rel1.filePath)) {
    throw new Error(`❌ 测试 1 失败：物理文件未保存至 ${rel1.filePath}`);
  }
  if (!rel1.emailNotification || !rel1.emailNotification.previewHtml.includes('release-1')) {
    throw new Error(`❌ 测试 1 失败：邮件通知内容未包含 release-1 标识`);
  }
  console.log('✅ [测试 1 通过] 成功生成 release-1 并生成对应邮件通知！\n');

  // Test 2: Upload second APK -> Expected release-2 (Auto-increment & Unique)
  console.log('▶️ [测试 2] 第二次推送上传 APK 文件 (自增与唯一性校验)...');
  const fakeApkBuffer2 = Buffer.from('PK\x03\x04MockBinaryApkFilePayloadNumber2WithUpdates');
  const res2 = createReleaseFromApk({
    fileBuffer: fakeApkBuffer2,
    originalFileName: 'app-pilot-v1.0.1.apk',
    version: 'v1.0.1',
    channel: '智驾云·车机正式版',
    changelog: '1. 修复音频流采样率偶发不同步问题\n2. 优化高清地图图层渲染帧率',
    recipients: 'qa@zhijiayun.com, dev-leads@zhijiayun.com',
    host: 'localhost:3000'
  });

  const rel2 = res2.release;
  console.log(`  -> 生成 Release 包名: ${rel2.releaseName}`);
  console.log(`  -> MD5 校验码: ${rel2.md5}`);
  console.log(`  -> 文件大小: ${rel2.fileSizeFormatted}`);
  console.log(`  -> 邮件主题: ${res2.emailRecord.subject}`);

  if (rel2.releaseName !== 'release-2') {
    throw new Error(`❌ 测试 2 失败：期望包名为 release-2，但生成了 ${rel2.releaseName}`);
  }
  if (rel1.releaseName === rel2.releaseName) {
    throw new Error(`❌ 测试 2 失败：包名重复，违反唯一性规则！`);
  }
  console.log('✅ [测试 2 通过] 成功生成自增且唯一的 release-2，邮件已同步分发！\n');

  // Test 3: Upload third APK -> Expected release-3
  console.log('▶️ [测试 3] 第三次推送上传 APK 文件 (校验 release-3)...');
  const fakeApkBuffer3 = Buffer.from('PK\x03\x04MockBinaryApkFilePayloadNumber3Bugfixes');
  const res3 = createReleaseFromApk({
    fileBuffer: fakeApkBuffer3,
    originalFileName: 'app-pilot-v1.0.2-beta.apk',
    version: 'v1.0.2',
    channel: '智驾云·研发测试版',
    changelog: '1. 升级 AOT 座舱诊断链路协议\n2. 增强弱网自动重连能力',
    host: 'localhost:3000'
  });

  const rel3 = res3.release;
  console.log(`  -> 生成 Release 包名: ${rel3.releaseName}`);
  if (rel3.releaseName !== 'release-3') {
    throw new Error(`❌ 测试 3 失败：期望包名为 release-3，但生成了 ${rel3.releaseName}`);
  }
  console.log('✅ [测试 3 通过] 成功生成 release-3！\n');

  // Test 4: Verify Store state and Auto-increment counter
  console.log('▶️ [测试 4] 校验持久化存储与自增计数器状态...');
  const store = getStore();
  console.log(`  -> 当前已保存 Release 包总数: ${store.releases.length}`);
  console.log(`  -> 下一个待生成 Release ID: ${store.nextId} (即 release-${store.nextId})`);
  console.log(`  -> 邮件通知累计记录数: ${store.emailLogs.length}`);

  if (store.releases.length !== 3) {
    throw new Error(`❌ 测试 4 失败：期望 3 个 release 包，实际有 ${store.releases.length}`);
  }
  if (store.nextId !== 4) {
    throw new Error(`❌ 测试 4 失败：期望 nextId 为 4，实际为 ${store.nextId}`);
  }
  console.log('✅ [测试 4 通过] 计数器与持久化列表状态完全符合设计！\n');

  // Test 5: Resend email
  console.log('▶️ [测试 5] 测试重新派发邮件通知功能 (形式 1)...');
  const resendLog = resendReleaseEmail(rel1.id);
  console.log(`  -> 重发记录 ID: ${resendLog.id}`);
  console.log(`  -> 重发主题: ${resendLog.subject}`);
  const updatedStore = getStore();
  if (updatedStore.emailLogs.length !== 4) {
    throw new Error(`❌ 测试 5 失败：邮件重发日志未成功追加`);
  }
  console.log('✅ [测试 5 通过] 邮件重新发送及日志追踪正常！\n');

  console.log('========================================================');
  console.log('🎉 所有自动化验证用例全部通过 (100% PASS)！');
  console.log('   - release-数字 自增唯一规则：验证通过');
  console.log('   - 形式 1 (邮件通知与预览系统)：验证通过');
  console.log('   - 形式 2 (推送自动打包显示在列表)：验证通过');
  console.log('========================================================\n');
}

runTestSuite().catch(err => {
  console.error('❌ 测试套件执行失败:', err);
  process.exit(1);
});
