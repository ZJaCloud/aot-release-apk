import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateReleaseSpec,
  formatAssetFileName,
  formatReleaseBody,
  createGitHubRelease,
  checkLatestRelease,
  compareSemver,
  DEFAULT_REPO,
  DEFAULT_PACKAGE_NAME
} from '../services/githubReleaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SAMPLE_APK = path.join(ROOT_DIR, 'sample-debug.apk');

async function runSpecTests() {
  console.log('================================================================');
  console.log('🧪 开始执行第三方接入规范与 GitHub Release 发布约束全量测试');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`❌ [FAIL] ${message}`);
      throw new Error(`断言失败: ${message}`);
    }
    passedTests++;
    console.log(`✅ [PASS] ${message}`);
  }

  // -------------------------------------------------------------
  // 测试 1: Tag 必须为 vX.Y.Z 语义化版本格式校验
  // -------------------------------------------------------------
  console.log('▶️ [测试组 1] 校验 Tag 格式与 vX.Y.Z 规范...');
  
  const invalidTagTest1 = validateReleaseSpec({
    repo: DEFAULT_REPO,
    tag: 'release-1', // 非法：之前的旧命名
    versionName: 'release-1',
    packageName: DEFAULT_PACKAGE_NAME,
    isPrerelease: false,
    isLatest: true,
    body: '测试日志',
    apkFileName: 'app.apk'
  });
  assert(!invalidTagTest1.valid, '成功拦截旧格式 release-1，严格禁止非 vX.Y.Z 格式');
  assert(invalidTagTest1.errors.some(e => e.includes('vX.Y.Z')), '错误信息明确提示必须符合 vX.Y.Z');

  const invalidTagTest2 = validateReleaseSpec({
    repo: DEFAULT_REPO,
    tag: '1.0.0', // 缺少 v 前缀
    versionName: '1.0.0',
    packageName: DEFAULT_PACKAGE_NAME,
    isPrerelease: false,
    isLatest: true,
    body: '测试日志',
    apkFileName: 'app.apk'
  });
  assert(!invalidTagTest2.valid, '成功拦截未加 v 前缀的 tag (如 1.0.0)');

  const validTagTest = validateReleaseSpec({
    repo: DEFAULT_REPO,
    tag: 'v1.0.0',
    versionName: '1.0.0',
    packageName: DEFAULT_PACKAGE_NAME,
    isPrerelease: false,
    isLatest: true,
    body: '1. 修复已知问题',
    apkFileName: 'app.apk'
  });
  assert(validTagTest.valid, '合法 Tag v1.0.0 成功通过校验');

  // -------------------------------------------------------------
  // 测试 2: Tag 必须与 APK 的 versionName 严格一致
  // -------------------------------------------------------------
  console.log('\n▶️ [测试组 2] 校验 Tag 与 APK 的 versionName 严格一致性...');

  const mismatchTest = validateReleaseSpec({
    repo: DEFAULT_REPO,
    tag: 'v2.0.0',
    versionName: '1.5.0', // 不一致
    packageName: DEFAULT_PACKAGE_NAME,
    isPrerelease: false,
    isLatest: true,
    body: '测试日志',
    apkFileName: 'app.apk'
  });
  assert(!mismatchTest.valid, '成功拦截 Tag (v2.0.0) 与 versionName (1.5.0) 不一致的情况');
  assert(mismatchTest.errors.some(e => e.includes('保持一致')), '错误信息包含版本必须一致的明确指引');

  const matchTest = validateReleaseSpec({
    repo: DEFAULT_REPO,
    tag: 'v2.1.0',
    versionName: 'v2.1.0', // 一致
    packageName: DEFAULT_PACKAGE_NAME,
    isPrerelease: false,
    isLatest: true,
    body: '测试日志',
    apkFileName: 'app.apk'
  });
  assert(matchTest.valid, 'Tag 与 versionName 一致时校验通过');

  // -------------------------------------------------------------
  // 测试 3: Asset 必须附带至少一个 .apk，且符合命名规范
  // -------------------------------------------------------------
  console.log('\n▶️ [测试组 3] 校验 Asset 必须为 .apk 且符合推荐命名...');

  const nonApkTest = validateReleaseSpec({
    repo: DEFAULT_REPO,
    tag: 'v1.0.0',
    versionName: '1.0.0',
    packageName: DEFAULT_PACKAGE_NAME,
    isPrerelease: false,
    isLatest: true,
    body: '测试日志',
    apkFileName: 'app-release.zip' // 非 apk
  });
  assert(!nonApkTest.valid, '成功拦截非 .apk 后缀的产物 (zip)');

  // 验证推荐命名生成：{packageName}-{version}.apk
  const formattedName1 = formatAssetFileName('com.xxx.pos', '1.0.0');
  assert(formattedName1 === 'com.xxx.pos-v1.0.0.apk', `Asset 推荐命名正确: ${formattedName1}`);

  const formattedName2 = formatAssetFileName(DEFAULT_PACKAGE_NAME, '2.3.4');
  assert(formattedName2 === `${DEFAULT_PACKAGE_NAME}-v2.3.4.apk`, `默认包名 Asset 命名正确: ${formattedName2}`);

  const preferredName = formatAssetFileName('com.xxx.pos', '1.0.0', 'app-release.apk');
  assert(preferredName === 'app-release.apk', '支持保留约定的 app-release.apk 命名');

  // -------------------------------------------------------------
  // 测试 4: Latest 与 Pre-release 标定规范 (测试版不要当 Latest)
  // -------------------------------------------------------------
  console.log('\n▶️ [测试组 4] 校验 Latest 与 Pre-release 标定互斥与正确性...');

  const conflictTest = validateReleaseSpec({
    repo: DEFAULT_REPO,
    tag: 'v1.0.0-beta',
    versionName: '1.0.0-beta',
    packageName: DEFAULT_PACKAGE_NAME,
    isPrerelease: true,
    isLatest: true, // 冲突：测试版不能当 Latest
    body: '测试日志',
    apkFileName: 'app.apk'
  });
  assert(!conflictTest.valid, '成功拦截同时标记为 pre-release 和 Latest 的冲突操作');
  assert(conflictTest.errors.some(e => e.includes('严禁同时标记为 Latest')), '严格执行“测试版不要当 Latest”的约定');

  // -------------------------------------------------------------
  // 测试 5: Release 说明 (body) 渲染与门市更新对话框格式兼容
  // -------------------------------------------------------------
  console.log('\n▶️ [测试组 5] 校验 Release 说明 (body) 格式与门市展示内容...');

  const formattedBody = formatReleaseBody({
    changelog: '1. 优化 AOT 座舱协议通信延迟\n2. 修复弱网环境下重连失败问题',
    appName: '智驾云 AOT 客户端',
    packageName: DEFAULT_PACKAGE_NAME,
    versionName: '1.0.0',
    isPrerelease: false
  });
  assert(formattedBody.includes('## 📱 智驾云 AOT 客户端 更新说明'), 'body 包含标准门市 App 标题');
  assert(formattedBody.includes(DEFAULT_PACKAGE_NAME), 'body 包含精确 packageName');
  assert(formattedBody.includes('优化 AOT 座舱协议通信延迟'), 'body 包含完整 Changelog 内容');
  assert(formattedBody.includes('门市车机更新提示'), 'body 包含门市更新提示');

  // -------------------------------------------------------------
  // 测试 6: 端到端代码创建 Release (Dry-run 模式全链路测试)
  // -------------------------------------------------------------
  console.log('\n▶️ [测试组 6] 执行端到端 GitHub Release 创建流程 (Dry-run 演练)...');

  const releaseResult = await createGitHubRelease({
    repo: DEFAULT_REPO,
    tag: 'v1.0.0',
    versionName: '1.0.0',
    packageName: DEFAULT_PACKAGE_NAME,
    appName: '智驾云 AOT 客户端',
    changelog: '1. 首次按照第三方规范正式发版\n2. 适配门市云端 App 下载',
    isPrerelease: false,
    isLatest: true,
    apkFilePath: SAMPLE_APK,
    dryRun: true
  });

  assert(releaseResult.success, '创建 Release 执行成功 (dryRun: true)');
  assert(releaseResult.release.tag === 'v1.0.0', '生成的 Release Tag 为 v1.0.0');
  assert(releaseResult.release.isLatest === true, '正式版 make_latest 正确设置为 true');
  assert(releaseResult.release.isPrerelease === false, '正式版 prerelease 正确设置为 false');
  assert(releaseResult.release.asset.name === `${DEFAULT_PACKAGE_NAME}-v1.0.0.apk`, '附带规范的 .apk Asset 产物');
  assert(releaseResult.release.asset.md5.length === 32, '正确计算并附带 APK MD5 哈希');
  assert(releaseResult.release.payload.body.includes('适配门市云端 App 下载'), 'API Payload body 中完整携带更新说明');

  // -------------------------------------------------------------
  // 测试 7: 校验测试版 (Pre-release) 创建时的标定行为
  // -------------------------------------------------------------
  console.log('\n▶️ [测试组 7] 校验测试版 (Pre-release) 发布行为...');

  const betaReleaseResult = await createGitHubRelease({
    repo: DEFAULT_REPO,
    tag: 'v1.1.0-beta.1',
    versionName: '1.1.0-beta.1',
    packageName: DEFAULT_PACKAGE_NAME,
    appName: '智驾云 AOT 客户端',
    changelog: '测试内部先行版本',
    isPrerelease: true,
    isLatest: false,
    apkFilePath: SAMPLE_APK,
    dryRun: true
  });

  assert(betaReleaseResult.success, '测试版创建成功');
  assert(betaReleaseResult.release.isPrerelease === true, '测试版 prerelease 为 true');
  assert(betaReleaseResult.release.isLatest === false, '测试版 isLatest 为 false');
  assert(betaReleaseResult.release.payload.make_latest === "false", 'API Payload make_latest 严格为 "false"');

  // -------------------------------------------------------------
  // 测试 8: 语义化版本比对与 TPOS 门市判定规则
  // -------------------------------------------------------------
  console.log('\n▶️ [测试组 8] 校验 TPOS 门市版本语义化比对规则...');
  assert(compareSemver('V2.14.5', '2.14.4') === 1, 'Tag V2.14.5 > 已安装 2.14.4 判定为需更新');
  assert(compareSemver('v2.14.5', '2.14.5') === 0, 'Tag v2.14.5 == 已安装 2.14.5 判定为已是最新');
  assert(compareSemver('2.14.5', '2.15.0') === -1, 'Tag 2.14.5 < 已安装 2.15.0 判定无需更新');
  assert(compareSemver('v2.14.10', 'v2.14.5') === 1, 'Semver 补丁版本号 10 > 5 正确按数值比对');
  assert(compareSemver('V2.14.5', '') === 1, '未安装状态下，只要有最新版本即提示安装');

  console.log('\n================================================================');
  console.log(`🎉 全部 ${passedTests}/${totalTests} 个测试用例通过 (100% PASS)！`);
  console.log('   ✓ Tag: vX.Y.Z 且与 APK versionName 保持一致');
  console.log('   ✓ Asset: Release 附带至少一个 .apk (推荐 {packageName}-{version}.apk)');
  console.log('   ✓ Latest: 正式版才标 Latest，测试版标 pre-release 严禁标 Latest');
  console.log('   ✓ Release 说明: 写入 body，兼容更新对话框');
  console.log('   ✓ TPOS 判定: 语义化比对 (tag 决定版本，.apk 决定下载，文件名不影响)');
  console.log('================================================================\n');
}

runSpecTests().catch(err => {
  console.error('\n❌ 测试套件执行异常中断:', err);
  process.exit(1);
});
