# 第三方 App 接入与 GitHub Release 发布规范指引 (SOP)

本规范专为第三方开发者、各应用团队以及门市「云端 App 下载」系统对接而制定。  
各应用在完成规范对齐后，方可录入系统协同表（Sheet），并在更新监控器（Monitor）中自动化检测更新与下发 APK。

---

## 1. 必备对接信息清单 (信息对齐)

在正式上架/对接前，请第三方开发者向对接人提供以下 4 项核心信息：

| 必备项目 | 格式 / 示例 | 说明与约束 |
|---|---|---|
| **GitHub 公开 Repo** | `owner/repo`<br>*(例如: `takopos/pos-client` 或 `ZJaCloud/aot-release-apk`)* | 必须为 **公开 (Public)** 仓库，Monitor 将通过公开 GitHub API 检查版本及下载 Asset。 |
| **Android packageName** | `com.xxx.pos` / `com.zhijiayun.aot` | 即 `applicationId`，**必须与门市已安装版保持绝对一致**，否则系统无法完成覆盖安装。 |
| **App 门市显示名称** | 例如：`智驾云 AOT 客户端`、`TAKO 智能点餐 POS` | 门市在车机 / 终端设备「云端 App 下载」界面中看到的直观名称。 |
| **签名 Keystore 确认** | 确认统一签名密钥与 Alias | **关键点**：必须使用约定的同一把 Keystore 对 Release APK 签名，签名不一致将导致 Android 系统拒绝覆盖安装。 |

---

## 2. GitHub Release 发布约定 (必须遵守)

第三方开发者在每次发布新版本 APK 时，请务必严格遵守以下 4 条发布规则：

| 项目 | 要求规范与执行方式 | 规范原因 / 影响说明 |
|---|---|---|
| **Tag** | 严格采用 **`vX.Y.Z`** 格式<br>*(例如: `v1.0.0`、`v2.1.3`)*<br>**且必须与 APK 内的 `versionName` 保持绝对一致** | Monitor 通过 Tag 解析版本号。若 Tag 不符合规范（如直接写 `1.0.0` 或 `release-1`），监控器将无法正确比较版本大小。 |
| **Asset** | GitHub Release 附件中**必须附带至少一个 `.apk` 文件**。<br>推荐命名：<br>1. **`{packageName}-{version}.apk`** *(如 `com.zhijiayun.aot-v1.0.0.apk`)*<br>2. **`app-release.apk`** | 门市「云端 App 下载」将直接拉取 Release 下的第一个 `.apk` 资产文件。若仅发布源码未上传 APK 产物，门市将下载失败。 |
| **Latest** | **正式发布版**：勾选 `Set as the latest release` (Latest)<br>**测试/内测版**：勾选 `Set as a pre-release`，**严禁标记为 Latest** | 门市正式环境默认只向设备推送标有 `Latest` 的版本。若将测试版标为 Latest，可能导致门市误升级未经验证的测试版本。 |
| **Release 说明** | 在 GitHub Release 的 **`Description / Body`** 中撰写更新日志与说明 | 此区域的文本会直接同步并渲染在车机/终端设备的**版本更新提示对话框**中，供门店人员了解更新内容。 |

---

## 3. TPOS 版本判定与门市更新机制

### 怎么判断版本号
1. **装置上已安装的 TPOS**：
   - 读取 `packageName = com.sunmi.sm3xr4ap.restaurant_desktop` 的 `versionName`（系统 `PackageManager`）。
2. **GitHub 上的最新版**：
   - 接口请求：`https://api.github.com/repos/ZJaCloud/aot-release-apk/releases/latest`
   - 用 Release 的 **`tag_name`** 当作远端版本（会去掉前面的 `v` / `V`），例如 tag `V2.14.5` -> 当成 `2.14.5`。
3. **版本比对规则**：
   - **语义化比对**：远端版本 > 已安装版本 -> 弹窗提示是否更新 / 安装；
   - **若设备还未安装 TPOS**：只要存在 `latest` 正式版，就直接提示安装。

### 跟文件名的关系对照表
| 来源 | 用途 |
|---|---|
| **Release tag（如 `v2.14.5` / `V2.14.5`）** | **用来判断版本**（作为远端真实版本依据） |
| **Release 里的 `.apk asset`** | **用来下载安装**（门市拉取该资产进行安装） |
| **APK 档名本身** | **不拿来比版本**（文件名带什么格式皆不影响版本判定） |

---

## 4. 复制给第三方开发者的沟通模板 (可直接发送)

```markdown
您好，为了保障应用能在门市「云端 App 下载」中正常检测到更新并实现平滑覆盖安装，请在发布前与我们对齐以下信息及发布约定：

一、请提供以下 4 项基础信息：
1. GitHub 公开 Repo 地址（owner/repo，例如：xxx/xxx）：
2. Android packageName（applicationId，请务必与当前安装版本核对一致）：
3. 门市 App 显示名称（例如：智驾云 AOT 客户端）：
4. 签名确认：是否已使用约定一致的 release keystore 签名？（是/否）

二、后续每次发布新版本的约定（请团队开发与发布人员务必遵守）：
1. 【Tag 规范】：必须以 v 开头（如 v1.2.0），且与 APK 内部的 versionName 完全相同；
2. 【APK 附件】：在 GitHub Release 必须上传 .apk 文件（建议命名为 {packageName}-{version}.apk 或 app-release.apk）；
3. 【版本类型】：生产正式版请标记为「Latest」；若为测试版请仅标记「Pre-release」，切勿勾选 Latest；
4. 【更新说明】：请在 Release Description (正文) 中列出本次更新说明，该内容会直接在门店更新对话框中向用户显示。

感谢配合！
```

---

## 5. 常见问题排查与避坑指南 (FAQ)

1. **门市提示“安装失败：签名冲突/签名不一致”？**
   - **原因**：第三方开发者使用了不同的 keystore，或者本地使用了 debug.keystore 签名。
   - **解法**：必须使用正式 keystore 重新签名后覆盖发布。
2. **门市检查不到更新？**
   - **原因 1**：GitHub 仓库设为私有 (Private) 且未配置 Token。
   - **原因 2**：最新发布的 Release 勾选了 `pre-release` 且未标记 `Latest`。
   - **原因 3**：Release 中遗漏了 `.apk` 文件上传。
3. **版本更新弹窗中更新内容为空白？**
   - **原因**：发布 Release 时将 Description / Body 留空。
