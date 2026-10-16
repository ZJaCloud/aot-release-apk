# aot-release-apk

把 APK 拖进网页 → 自动读出包里的版本号 → 在 GitHub 上生成一个**符合第三方抓取规范**的 Release。

只做这一件事。没有邮件通知、没有本地版本库、没有多余页签。

---

## 它到底在解决什么问题

第三方平台（门市「云端 App 下载」）只会做一个动作：

```
GET https://api.github.com/repos/ZJaCloud/aot-release-apk/releases/latest
```

然后：

- 把返回的 **`tag_name`** 当成远端版本号（会剥掉前导 `v` / `V`，`V2.14.5` → `2.14.5`）
- 把 **`assets` 里的 `.apk`** 当成下载地址

所以**仓库里光有 tag 是不够的** —— 必须存在一个带 `.apk` 附件的 Release。
只有 tag 没有 Release、或 Release 里没有 `.apk`，门市那边都会报「查不到可用的安装包」。

---

## 快速开始

```bash
cp .env.example .env      # 填入 GITHUB_TOKEN
npm start                 # 打开 http://localhost:3000
```

然后把 APK 拖进去。页面会自动显示包名、版本号、将要生成的 tag，以及规范自检结果；
填好「更新说明」点发布即可。

Token 需要一个 classic PAT 并勾选 **`repo`** 权限：https://github.com/settings/tokens/new

---

## 必须遵守的 4 条发布规范

完整规范见 [`docs/THIRD_PARTY_SPEC.md`](docs/THIRD_PARTY_SPEC.md)。工具会强制校验：

| 项目 | 要求 | 工具怎么保证 |
|---|---|---|
| **Tag** | 必须 `vX.Y.Z`，且与 APK 内 `versionName` 一致 | 从 APK 里读 `versionName` 自动生成 tag，大小写 `v`/`V` 归一 |
| **Asset** | Release 必须带 ≥1 个 `.apk` | 自动上传，命名为 `{packageName}-v{version}.apk` |
| **Latest** | 正式版勾 Latest；测试版只勾 pre-release | 页面上的「正式版 / 测试版」单选，两者互斥 |
| **Body** | 更新说明写进 Release 正文（会显示在车机更新弹窗） | 更新说明必填，不填不让发布 |

> 一个仓库同时只能有一个 Latest。发新正式版会自动把旧版降级，这是预期行为。

---

## 环境要求

- **Node 18+**（用到原生 `fetch`；本机实测 22.x）。零 npm 依赖。
- **Android SDK build-tools**（提供 `aapt2`），用来读 APK 里的 `versionName` / `packageName`。

`aapt2` 的查找顺序：

```
$ANDROID_HOME  →  $ANDROID_SDK_ROOT  →  ~/Library/Android/sdk  →  ~/Android/Sdk
```

在每个 SDK 根目录下的 `build-tools/*/` 里取版本号最高的 `aapt2`（其次 `aapt`），
最后才退回 `PATH`。都找不到时页面会直接报「请设置 ANDROID_HOME」。

> 为什么不纯 JS 解析：`versionName` 在 AndroidManifest 里可能是 `@string/xxx` 资源引用，
> 纯 JS 还得再解 `resources.arsc`，成本高且没必要。

---

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/config` | 返回仓库、Token 是否已配置、应用默认显示名 |
| `POST` | `/api/inspect` | 请求体就是 APK 原始字节（`Content-Type: application/octet-stream`，文件名放 `X-Filename`）。边落盘边算 MD5，解析出包名/版本号，返回规范自检结果。**不碰 GitHub** |
| `POST` | `/api/publish` | JSON `{ stagedId, changelog, prerelease, appName?, dryRun? }`。走完整规范校验后创建 Release 并上传 `.apk` |
| `GET` | `/api/latest` | 用第三方的方式回读一次 `/releases/latest`，验证它们能抓到什么 |

`POST /api/inspect` 会把文件暂存到 `data/.stage/`（已被 `.gitignore` 忽略），
发布成功后自动清理，超过 1 小时的残留会在下次上传时被扫掉。

---

## 目录结构

```
server.js                      # 静态服务 + 上面 4 个接口
services/
  apkInspector.js              # 定位 aapt2 + 解析 APK 元信息 + 算 MD5
  githubReleaseService.js      # 规范校验、semver 比对、建 Release、传附件、回读 latest
  staging.js                   # APK 暂存区
public/                        # 单页前端：拖拽 → 确认 → 发布
test/
  test-github-release.js       # 规范校验 / payload / 大写 V 回归
  test-apk-inspector.js        # 真包解析（真包不在时自动跳过）
docs/THIRD_PARTY_SPEC.md       # 第三方对接规范原文
data/                          # 运行期数据，不入库
```

---

## 测试

```bash
npm test
```

`test-apk-inspector.js` 会对 `data/uploads/release-4/release-4.apk` 做断言。
想换样本，把任意真实 APK 放到那个路径即可；文件不存在时这组断言会自动跳过。

---

## 常见问题

**门市检查不到更新？**
依次确认：① Release 有没有勾上 Latest（不是 pre-release）；② Release 里有没有 `.apk` 附件；
③ 仓库是不是公开的。直接 `curl https://api.github.com/repos/ZJaCloud/aot-release-apk/releases/latest` 看 `tag_name` 和 `assets` 最清楚。

**发布报 404 / 权限不足？**
Token 没勾 `repo` 权限，或者组织启用了 SSO 而 Token 没授权给该组织。
错误信息里会带上诊断结论。

**发布报 `422 already_exists`？**
同版本号的 Release 已经存在。工具会自动改成复用那个 Release 并把 `.apk` 补传上去，
所以「有 Release 但没附件」的情况可以直接重新发布修好。

**门市提示「安装失败：签名冲突」？**
这个工具管不了 —— 必须用约定一致的 release keystore 重新签名。
