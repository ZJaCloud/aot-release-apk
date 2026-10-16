# aot-relase-apk — 项目长期约定

## 这个项目是什么
本地网页工具：**拖入 APK → 自动读版本号 → 在 GitHub 生成符合第三方抓取规范的 Release**。
刻意保持极简，只有这一条链路。不要重新引入邮件通知、本地版本库、多页签。

## 权威规范
`docs/THIRD_PARTY_SPEC.md` 是权威，改动前先读它。4 条硬要求：
1. Tag 必须 `vX.Y.Z`，且与 APK 内 `versionName` 一致
2. Release 必须带 ≥1 个 `.apk` 附件（平台只取第一个 `.apk`）
3. 正式版勾 Latest；测试版只能 pre-release，**严禁** Latest
4. 更新说明写进 Release 正文（会显示在车机更新弹窗），不能为空

## 第三方抓取契约（所有设计的出发点）
```
GET https://api.github.com/repos/ZJaCloud/aot-release-apk/releases/latest
→ tag_name 当远端版本（剥前导 v/V）；assets 里的 .apk 当下载地址
```
**光有 git tag 没用，必须有带 `.apk` 附件的 Release。**

## 关键事实
- 目标仓库：`ZJaCloud/aot-release-apk`。**这个仓库既是工具仓库又是发版仓库**（Release 列表里会混着工具 tag，是抓取要求决定的，不改）。
- 真包：`packageName = com.sunmi.sm3xr4ap.restaurant_desktop`，`versionName` 是 **大写 V**（如 `V2.14.5`）。
  ⇒ 任何版本号比较/生成 tag 的地方都必须用 `/^[vV]/` 归一，输出统一小写 `v2.14.5`。**这是踩过的坑。**
- 本机 aapt2：`~/Library/Android/sdk/build-tools/36.1.0/aapt2`（35.0.0 也有）。`ANDROID_HOME` 未设置。
  `adb` / `gh` / `apkanalyzer` 都没装。
- 零 npm 依赖是刻意选择（原生 `node:http` + `fetch` + `--env-file-if-exists`）。加依赖前先想清楚。

## 工程约定
- `data/` 与 `*.apk` **一律不入库**（APK 走 GitHub Release 附件分发，不塞进 git）。
  Token 只放 `.env`（已 gitignore），绝不写进任何会被提交的文件。
- 一个仓库同时只能有一个 Latest，发新正式版会自动降级旧版 —— 预期行为。
- 同版本重发：GitHub 返回 422 `already_exists` → 代码会 fallback 到复用已有 Release 并补传附件。
  所以「有 Release 但没附件」的情况直接重发即可修好。
- 测试样本放在 `data/uploads/release-4/release-4.apk`；真包不存在时 `test-apk-inspector.js` 会自动跳过。

## 测试
`npm test` → `test-github-release.js`（规范校验/payload/大写 V 回归）+ `test-apk-inspector.js`（真包解析）。
