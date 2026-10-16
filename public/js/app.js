const $ = (sel) => document.querySelector(sel);

let cfg = { repo: '', hasToken: false, appName: '', expectedPackageName: '' };
let staged = null;   // /api/inspect 的返回
let busy = false;

// ───────────────────────────────────────────── 工具

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 5000);
}

function setStatus(msg, isError = false) {
  const el = $('#inspect-status');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
  el.classList.toggle('error', isError);
}

// ───────────────────────────────────────────── 启动

init();

async function init() {
  try {
    cfg = await (await fetch('/api/config')).json();
  } catch {
    toast('连不上本地服务，请确认 npm start 还在运行', 'error');
    return;
  }

  $('#repo-badge').textContent = cfg.repo;

  const tb = $('#token-badge');
  tb.textContent = cfg.hasToken ? 'Token 已配置' : 'Token 未配置';
  tb.classList.add(cfg.hasToken ? 'ok' : 'warn');

  $('#appname').value = cfg.appName || '';

  wireDropzone();
  $('#changelog').addEventListener('input', updatePublishState);
  document.querySelectorAll('input[name="kind"]').forEach((el) =>
    el.addEventListener('change', updatePublishState)
  );
  $('#btn-publish').addEventListener('click', () => publish(false));
  $('#btn-dryrun').addEventListener('click', () => publish(true));
  $('#btn-reset').addEventListener('click', reset);
  $('#check-latest').addEventListener('click', checkLatest);

  updatePublishState();
}

// ───────────────────────────────────────────── 拖拽 / 上传

function wireDropzone() {
  const dz = $('#dropzone');
  const input = $('#file-input');

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => {
    if (input.files[0]) uploadFile(input.files[0]);
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); })
  );
  dz.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  });

  // 拖到页面其它地方时，别让浏览器直接把 APK 打开
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

function uploadFile(file) {
  if (busy) return;
  if (!file.name.toLowerCase().endsWith('.apk')) {
    toast('只接受 .apk 文件', 'error');
    return;
  }

  busy = true;
  updatePublishState();
  $('#step-review').classList.add('hidden');
  $('#step-result').classList.add('hidden');
  setStatus(`正在上传 ${file.name}（${fmtSize(file.size)}）… 0%`);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/inspect');
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      setStatus(`正在上传 ${file.name} … ${Math.round((e.loaded / e.total) * 100)}%`);
    }
  };

  xhr.onload = () => {
    busy = false;
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch { /* 交给下面的错误分支 */ }

    if (xhr.status !== 200 || !data.ok) {
      setStatus(data.error || `解析失败（HTTP ${xhr.status}）`, true);
      toast(data.error || '解析失败', 'error');
      updatePublishState();
      return;
    }

    setStatus(`已解析：${data.packageName} · ${data.versionName}`);
    staged = data;
    renderReview(data);
    updatePublishState();
  };

  xhr.onerror = () => {
    busy = false;
    setStatus('上传失败，请确认本地服务仍在运行', true);
    updatePublishState();
  };

  xhr.send(file);
}

// ───────────────────────────────────────────── 渲染

function renderReview(d) {
  $('#r-file').textContent = d.fileName;
  $('#r-package').textContent = d.packageName;
  $('#r-versionname').textContent = d.versionName;
  $('#r-tag').textContent = d.tag;
  $('#r-asset').textContent = d.assetName;
  $('#r-size').textContent = `${fmtSize(d.size)}（${d.size.toLocaleString()} 字节）`;
  $('#r-md5').textContent = d.md5;

  const ul = $('#r-checks');
  ul.innerHTML = '';
  for (const c of d.checks) {
    const li = document.createElement('li');
    li.className = c.ok ? 'ok' : (c.warnOnly ? 'warn' : 'bad');
    li.innerHTML =
      `<span class="mark">${c.ok ? '✓' : (c.warnOnly ? '!' : '✕')}</span>` +
      `<span class="txt">${esc(c.label)}</span>` +
      `<span class="detail">${esc(c.detail || '')}</span>`;
    ul.appendChild(li);
  }

  $('#step-review').classList.remove('hidden');
  $('#step-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updatePublishState() {
  const btnPublish = $('#btn-publish');
  const btnDry = $('#btn-dryrun');
  const note = $('#publish-note');

  const hardFail = staged ? staged.checks.some((c) => !c.ok && !c.warnOnly) : false;
  const hasChangelog = Boolean($('#changelog').value.trim());

  btnPublish.disabled = busy || !staged || hardFail || !hasChangelog || !cfg.hasToken;
  btnDry.disabled = busy || !staged || hardFail || !hasChangelog;

  const reasons = [];
  if (!cfg.hasToken) reasons.push('还没有配置 GITHUB_TOKEN（见 .env.example），所以只能演练');
  if (hardFail) reasons.push('上面有规范自检未通过，不能发布');
  if (staged && !hasChangelog) reasons.push('更新说明是必填的');

  if (reasons.length) {
    note.innerHTML = reasons.map((r) => `· ${esc(r)}`).join('<br>');
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
}

function renderResult(d) {
  const r = d.release;
  const box = $('#step-result');

  box.innerHTML = `
    <h2>${d.dryRun ? '演练结果（没有真的发布）' : '发布成功'}</h2>
    <dl class="kv">
      <dt>Tag</dt><dd class="mono strong">${esc(r.tag)}</dd>
      <dt>版本类型</dt><dd>${r.isPrerelease ? '测试版 (pre-release)' : '正式版 (Latest)'}</dd>
      <dt>附件</dt><dd class="mono">${esc(r.asset.name)} · ${fmtSize(r.asset.size)}</dd>
      <dt>MD5</dt><dd class="mono">${esc(r.asset.md5)}</dd>
      <dt>Release 页面</dt><dd class="mono">${esc(r.htmlUrl)}</dd>
    </dl>
    <div class="actions" style="margin-top:16px">
      <a class="btn" href="${esc(r.htmlUrl)}" target="_blank" rel="noopener">打开 Release 页面</a>
      <a class="btn" href="${esc(r.asset.downloadUrl)}" target="_blank" rel="noopener">下载附件</a>
    </div>
    ${d.dryRun
      ? '<p class="hint">演练模式：以上链接只是「将要生成」的地址，GitHub 上并没有真的创建。</p>'
      : '<p class="hint">发布成功后暂存文件已清理。用下面的「线上最新版自检」可以立刻验证第三方能抓到什么。</p>'}
  `;

  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPublishError(d) {
  const box = $('#step-result');
  const list = Array.isArray(d.validationErrors) && d.validationErrors.length
    ? `<ul class="checks">${d.validationErrors
        .map((e) => `<li class="bad"><span class="mark">✕</span><span class="txt">${esc(e)}</span></li>`)
        .join('')}</ul>`
    : '';

  box.innerHTML = `<h2>发布失败</h2><div class="verdict bad">${esc(d.error || '未知错误')}</div>${list}`;
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ───────────────────────────────────────────── 动作

async function publish(dryRun) {
  if (busy || !staged) return;

  busy = true;
  updatePublishState();
  const label = dryRun ? '演练中…' : '发布中…（正在上传 APK 到 GitHub，请勿关闭页面）';
  const btn = dryRun ? $('#btn-dryrun') : $('#btn-publish');
  const original = btn.textContent;
  btn.textContent = label;

  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stagedId: staged.stagedId,
        changelog: $('#changelog').value,
        prerelease: document.querySelector('input[name="kind"]:checked').value === 'test',
        appName: $('#appname').value.trim() || undefined,
        dryRun
      })
    });
    const data = await res.json();

    if (!data.ok) {
      renderPublishError(data);
      toast(dryRun ? '演练未通过' : '发布失败', 'error');
      return;
    }

    renderResult(data);
    toast(dryRun ? '演练通过（没有真的发布）' : `已发布 ${data.release.tag}`, 'ok');
  } catch (err) {
    toast(`请求失败：${err.message}`, 'error');
  } finally {
    busy = false;
    btn.textContent = original;
    updatePublishState();
  }
}

function reset() {
  staged = null;
  $('#step-review').classList.add('hidden');
  $('#step-result').classList.add('hidden');
  $('#changelog').value = '';
  setStatus('');
  updatePublishState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function checkLatest() {
  const btn = $('#check-latest');
  btn.disabled = true;
  $('#latest-result').innerHTML = '<p class="hint">查询中…</p>';

  try {
    renderLatest(await (await fetch('/api/latest')).json());
  } catch (err) {
    $('#latest-result').innerHTML = `<div class="verdict bad">查询失败：${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function renderLatest(d) {
  const box = $('#latest-result');

  if (d.error) {
    box.innerHTML = `<div class="verdict bad">查询失败：${esc(d.error)}</div>`;
    return;
  }

  if (!d.latestTag) {
    box.innerHTML =
      `<div class="verdict bad">第三方现在<b>抓不到任何正式版</b>（<code>/releases/latest</code> 返回 404）。` +
      `${esc(d.message || '')}</div>`;
    return;
  }

  const okAsset = Boolean(d.asset);
  const headline = okAsset
    ? `第三方会看到版本 <b>${esc(d.latestVersion)}</b>（tag <code>${esc(d.latestTag)}</code>），并能下载到 <code>${esc(d.asset.name)}</code>`
    : `第三方会看到版本 <b>${esc(d.latestVersion)}</b>，但这个 Release <b>没有 .apk 附件</b>，门市会下载失败`;

  box.innerHTML = `
    <div class="verdict ${okAsset ? 'ok' : 'bad'}">${headline}</div>
    <dl class="kv">
      <dt>Release 名称</dt><dd>${esc(d.releaseName || '—')}</dd>
      <dt>发布时间</dt><dd>${esc(d.publishedAt || '—')}</dd>
      <dt>附件下载地址</dt><dd class="mono">${d.asset ? esc(d.asset.downloadUrl) : '无'}</dd>
    </dl>
  `;
}
