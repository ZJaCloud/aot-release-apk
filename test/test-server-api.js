import { server } from '../server.js';
import { EventEmitter } from 'node:events';

async function dispatchRequest({ method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost:3000', ...headers };

    let resBody = '';
    let resHeaders = {};
    let statusCode = 200;

    const res = {
      setHeader(k, v) { resHeaders[k.toLowerCase()] = v; },
      getHeader(k) { return resHeaders[k.toLowerCase()]; },
      writeHead(code, h) {
        statusCode = code;
        if (h) Object.assign(resHeaders, h);
      },
      end(chunk) {
        if (chunk) resBody += chunk.toString();
        resolve({
          status: statusCode,
          headers: resHeaders,
          text: () => Promise.resolve(resBody),
          json: () => Promise.resolve(JSON.parse(resBody || '{}'))
        });
      }
    };

    server.emit('request', req, res);

    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.emit('data', Buffer.from(payload));
    }
    req.emit('end');
  });
}

async function runApiIntegrationTest() {
  console.log('======================================================');
  console.log('🚀 启动 Server HTTP API 零网络依赖内存集成测试');
  console.log('======================================================\n');

  // 1. GET /api/github/config
  console.log('▶️ [接口测试 1] GET /api/github/config ...');
  const cfgResp = await dispatchRequest({ method: 'GET', url: '/api/github/config' });
  const cfgJson = await cfgResp.json();
  if (cfgJson.code !== 0 || !cfgJson.data.repo) {
    throw new Error(`配置接口响应异常: ${JSON.stringify(cfgJson)}`);
  }
  console.log(`  -> 默认仓库: ${cfgJson.data.repo}, 包名: ${cfgJson.data.packageName}`);
  console.log('✅ [接口测试 1 通过]\n');

  // 2. POST /api/github/release (Dry-run 发布演练)
  console.log('▶️ [接口测试 2] POST /api/github/release (规范校验与发布)...');
  const releasePayload = {
    repo: 'ZJaCloud/aot-release-apk',
    version: '1.2.0',
    tag: 'v1.2.0',
    package: 'com.zhijiayun.aot',
    appName: '智驾云 AOT 客户端',
    changelog: '1. API 接口自动化测试发布\n2. 校验门市更新对话框格式',
    isLatest: true,
    dryRun: true
  };

  const relResp = await dispatchRequest({
    method: 'POST',
    url: '/api/github/release',
    headers: { 'content-type': 'application/json' },
    body: releasePayload
  });
  const relJson = await relResp.json();
  if (relJson.code !== 0 || !relJson.data.tag) {
    throw new Error(`发布接口响应异常: ${JSON.stringify(relJson)}`);
  }
  console.log(`  -> 生成 Release Tag: ${relJson.data.tag}`);
  console.log(`  -> 生成 Asset 产物名: ${relJson.data.asset.name}`);
  console.log(`  -> 运行模式: ${relJson.dryRun ? 'Dry-run 演练' : '线上发布'}`);
  console.log('✅ [接口测试 2 通过]\n');

  // 3. 校验非法 Tag 拦截
  console.log('▶️ [接口测试 3] POST /api/github/release (非法 Tag 拦截校验)...');
  const badPayload = {
    ...releasePayload,
    tag: 'release-99', // 违反 vX.Y.Z 规范
    version: '1.2.0'
  };
  const badResp = await dispatchRequest({
    method: 'POST',
    url: '/api/github/release',
    headers: { 'content-type': 'application/json' },
    body: badPayload
  });
  const badJson = await badResp.json();
  if (badResp.status !== 400 || !badJson.validationErrors || badJson.validationErrors.length === 0) {
    throw new Error(`预期 400 校验拦截失败: ${JSON.stringify(badJson)}`);
  }
  console.log(`  -> 成功拦截并返回: ${badJson.validationErrors[0]}`);
  console.log('✅ [接口测试 3 通过]\n');

  // 4. GET /api/github/check-update
  console.log('▶️ [接口测试 4] GET /api/github/check-update (Monitor 检查更新)...');
  const checkResp = await dispatchRequest({
    method: 'GET',
    url: '/api/github/check-update?repo=ZJaCloud/aot-release-apk&currentVersion=v1.0.0'
  });
  const checkJson = await checkResp.json();
  if (checkJson.code !== 0) {
    throw new Error(`更新检查接口响应异常: ${JSON.stringify(checkJson)}`);
  }
  console.log(`  -> 检查结果: repo=${checkJson.data.repo}, currentVersion=${checkJson.data.currentVersion}`);
  console.log('✅ [接口测试 4 通过]\n');

  console.log('======================================================');
  console.log('🎉 所有 HTTP API 接口集成验证 100% 全部通过！');
  console.log('======================================================\n');
}

runApiIntegrationTest().catch(err => {
  console.error('❌ 集成测试失败:', err);
  process.exit(1);
});
