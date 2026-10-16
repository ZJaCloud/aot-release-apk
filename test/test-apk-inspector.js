import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAapt, inspectApk, md5File } from '../services/apkInspector.js';

/**
 * APK 元信息解析测试。
 * 用真包做断言（data/uploads/release-4/release-4.apk）；真包不在时跳过，不误报失败。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const REAL_APK = path.join(ROOT_DIR, 'data', 'uploads', 'release-4', 'release-4.apk');

let passed = 0;
let total = 0;

function assert(cond, msg) {
  total++;
  if (!cond) {
    console.error(`❌ [FAIL] ${msg}`);
    throw new Error(`断言失败: ${msg}`);
  }
  passed++;
  console.log(`✅ [PASS] ${msg}`);
}

function run() {
  console.log('================================================================');
  console.log('🧪 APK 元信息解析测试 (aapt2 dump badging)');
  console.log('================================================================\n');

  console.log('▶️ [测试组 1] 定位 aapt2 / aapt...');
  const aapt = resolveAapt();
  if (!aapt) {
    console.error('❌ 本机找不到 aapt2 / aapt —— 请安装 Android SDK build-tools 或设置 ANDROID_HOME');
    process.exit(1);
  }
  console.log(`   -> ${aapt.bin} ${aapt.version} @ ${aapt.path}（来源: ${aapt.source}）`);
  assert(fs.existsSync(aapt.path), 'aapt 可执行文件确实存在');

  console.log('\n▶️ [测试组 2] 错误处理...');

  let missingCode = '';
  try {
    inspectApk(path.join(ROOT_DIR, 'definitely-not-here.apk'));
  } catch (err) {
    missingCode = err.code;
  }
  assert(missingCode === 'APK_NOT_FOUND', '文件不存在时报 APK_NOT_FOUND');

  const tmp = path.join(os.tmpdir(), `not-an-apk-${process.pid}.apk`);
  fs.writeFileSync(tmp, 'this is definitely not a zip/apk');
  let notApkCode = '';
  try {
    inspectApk(tmp);
  } catch (err) {
    notApkCode = err.code;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  assert(notApkCode === 'NOT_AN_APK' || notApkCode === 'AAPT_FAILED', '非 APK 文件被明确拒绝（不会静默通过）');

  console.log('\n▶️ [测试组 3] 解析真包 (com.sunmi.sm3xr4ap.restaurant_desktop)...');

  if (!fs.existsSync(REAL_APK)) {
    console.log(`   ⏭️  跳过：真包样本不存在 (${REAL_APK})`);
    console.log('      把任意真实 APK 放到该路径即可启用这组断言。');
  } else {
    const info = inspectApk(REAL_APK);
    console.log(`   -> ${JSON.stringify(info)}`);

    assert(info.packageName === 'com.sunmi.sm3xr4ap.restaurant_desktop', `packageName 正确 (${info.packageName})`);
    assert(info.versionName === 'V2.14.5', `versionName 保留包内原值 V2.14.5（实际 ${info.versionName}）`);
    assert(info.version === '2.14.5', `归一化版本号为 2.14.5（实际 ${info.version}）`);
    assert(info.tag === 'v2.14.5', `生成的 tag 为 v2.14.5（实际 ${info.tag}）`);
    assert(/^\d+$/.test(info.versionCode), `versionCode 为数字 (${info.versionCode})`);

    const md5 = md5File(REAL_APK);
    assert(md5.length === 32 && /^[0-9a-f]+$/.test(md5), `MD5 计算正常 (${md5})`);
  }

  console.log('\n================================================================');
  console.log(`🎉 全部 ${passed}/${total} 个断言通过`);
  console.log('================================================================\n');
}

try {
  run();
} catch (err) {
  console.error('\n❌ 测试中断:', err.message);
  process.exit(1);
}
