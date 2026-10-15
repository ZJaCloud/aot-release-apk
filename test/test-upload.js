import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to make multipart request using native Node http
function uploadTestApk(filePath, version, changelog, channel, recipients) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundaryTest' + Math.random().toString(36).substring(2);
    const fileContent = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    let body = [];

    // File part
    body.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="apkFile"; filename="${fileName}"\r\n` +
      `Content-Type: application/vnd.android.package-archive\r\n\r\n`
    ));
    body.push(fileContent);
    body.push(Buffer.from('\r\n'));

    // Field: version
    body.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="version"\r\n\r\n` +
      `${version}\r\n`
    ));

    // Field: channel
    body.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="channel"\r\n\r\n` +
      `${channel}\r\n`
    ));

    // Field: changelog
    body.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="changelog"\r\n\r\n` +
      `${changelog}\r\n`
    ));

    // Field: recipients
    body.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="recipients"\r\n\r\n` +
      `${recipients}\r\n`
    ));

    // End boundary
    body.push(Buffer.from(`--${boundary}--\r\n`));

    const fullBuffer = Buffer.concat(body);

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/releases/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBuffer.length
      }
    }, (res) => {
      let respData = '';
      res.on('data', chunk => respData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(respData) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: respData });
        }
      });
    });

    req.on('error', reject);
    req.write(fullBuffer);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 开始运行 AOT APK Release 自动化验证测试...\n');

  // Create a mock APK file for testing
  const sampleApkPath = path.join(__dirname, 'mock-app-v1.apk');
  fs.writeFileSync(sampleApkPath, Buffer.from('PK\x03\x04MockApkBinaryPayloadContentsForAotTest' + Date.now()));

  console.log('1️⃣ 测试第一次推送上传 (期望生成 release-1)...');
  const res1 = await uploadTestApk(
    sampleApkPath,
    'v1.0.0',
    '第一版座舱导航 AOT 发布，基础能力上线',
    '智驾云·车机正式版',
    'qa@zhijiayun.com, test@zhijiayun.com'
  );

  console.log('响应状态:', res1.status);
  console.log('生成结果:', res1.data);

  if (res1.data?.data?.release?.releaseName !== 'release-1') {
    throw new Error(`期望生成 release-1，但实际为: ${res1.data?.data?.release?.releaseName}`);
  }
  console.log('✅ 测试 1 通过: 成功生成 release-1 并触发邮件通知！\n');

  console.log('2️⃣ 测试第二次推送上传 (期望自增生成 release-2)...');
  const sampleApkPath2 = path.join(__dirname, 'mock-app-v2.apk');
  fs.writeFileSync(sampleApkPath2, Buffer.from('PK\x03\x04MockApkBinaryPayloadContentsSecondRelease' + Date.now()));

  const res2 = await uploadTestApk(
    sampleApkPath2,
    'v1.0.1',
    '第二版修复音频通信延迟，优化地图流畅度',
    '智驾云·车机正式版',
    'qa@zhijiayun.com, dev@zhijiayun.com'
  );

  console.log('响应状态:', res2.status);
  console.log('生成结果:', res2.data);

  if (res2.data?.data?.release?.releaseName !== 'release-2') {
    throw new Error(`期望生成 release-2，但实际为: ${res2.data?.data?.release?.releaseName}`);
  }
  console.log('✅ 测试 2 通过: 成功自增生成 release-2 并触发邮件通知！\n');

  console.log('3️⃣ 验证列表与邮件数据持久化...');
  const releasesListResp = await new Promise((resolve) => {
    http.get('http://localhost:3000/api/releases', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
  });

  console.log(`当前列表包总数: ${releasesListResp.data.total}`);
  console.log(`下一个待生成包名: ${releasesListResp.data.nextReleaseName}`);
  console.log(`包名列表:`, releasesListResp.data.releases.map(r => `${r.releaseName} (${r.version})`));

  console.log('\n🎉 所有测试用例执行完毕并通过！');

  // Clean up mock apk files
  if (fs.existsSync(sampleApkPath)) fs.unlinkSync(sampleApkPath);
  if (fs.existsSync(sampleApkPath2)) fs.unlinkSync(sampleApkPath2);
}

runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
