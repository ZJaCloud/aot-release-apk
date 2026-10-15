# 智驾云 AOT · APK 自动构建 Release 与邮件通知平台

本项目专为前端/客户端上传最新 APK 包并实现自动化 Release 打包及发布通知而设计。

---

## 🌟 核心需求与两大功能形式

### 1. Release 包命名规范
- 包名定义：严格采用 **`release-数字`** 形式（如 `release-1`、`release-2`、`release-3` ...）。
- 编号保证**全局唯一且自动递增**，即便删除或刷新亦保持自增序列连续性。

### 2. 形式 1：版本更新邮件通知功能 (Email Notification)
- **自动触发**：每次推送上传 APK 并完成打包后，系统自动生成对应的版本发布邮件。
- **邮件内容包含**：
  - Release 包标识（如 `release-1`）
  - 应用版本号（如 `v1.0.0`）、适配发布渠道
  - APK 文件名、包体大小、MD5 完整性校验哈希
  - 发布时间与更新日志（Changelog）说明
  - 一键下载 APK 链接及操作指引
  - 通知抄送人列表（QA、研发主管、产品团队等）
- **交互与管理**：
  - 支持在前端弹窗所见即所得预览 HTML 邮件卡片；
  - 提供一键复制邮件富文本 HTML / 正文功能；
  - 支持针对特定历史版本手动一键“重新推送邮件”；
  - 拥有独立的“邮件通知中心”，可配置发件人、默认收件人群组、邮件主题模板及查看历史投递日志。

### 3. 形式 2：推送上传自动打成 Release 包并展示在列表 (Auto Packaging & List)
- **文件上传与推送**：
  - 支持拖拽或选择 `.apk` 文件；
  - 自动识别文件名、版本号与体积大小，展示上传进度；
  - 点击“推送并自动生成 Release 包”后，系统自动分配 `release-N` 递增编号，并在服务端持久化存储 APK。
- **Release 管理列表**：
  - 实时响应最新生成的 Release 包，倒序排列（最新发布的置顶）；
  - 列表清晰展示：Release 编号、应用版本、渠道标签、原始文件名、包体大小、MD5（带一键复制）、打包时间、邮件通知状态；
  - **直接下载**：点击操作栏【📥 下载】直接下载对应版本的 `.apk` 文件；
  - 支持按包名、版本号或更新日志关键字动态搜索筛选。

### 4. 形式 3：第三方规范落地与自动化 GitHub Release 发布 (GitHub Release Automation)
- **严格遵循第三方 4 大发布约定**：
  1. **Tag**：必须采用 `vX.Y.Z` 语义化格式，且严格与 APK 的 `versionName` 保持一致；
  2. **Asset**：必须附带至少一个 `.apk` 安装包（推荐命名 `{packageName}-{version}.apk` 或 `app-release.apk`）；
  3. **Latest**：正式版标记为 `Latest`；测试版标记为 `pre-release`（严禁标为 Latest）；
  4. **Release 说明**：更新日志写入 `body`，供门市更新对话框拉取展示。
- **发布方式**：
  - **CLI 命令行发布**：`node scripts/publish-release.js` 一键发布；
  - **Web 界面发布**：通过可视化控制台在线发布并实时校验；
  - **Dry-run 演练模式**：无需 Token 即可在本地完整校验 4 大规范。
- **Monitor 检查更新模拟器**：模拟门市「云端 App 下载」向 GitHub 查询最新版本并渲染更新提示对话框。
- **第三方开发者接入指引**：详见规范手册 [docs/THIRD_PARTY_SPEC.md](file:///Users/jinmokai/work/zhijiayun/aot-relase-apk/docs/THIRD_PARTY_SPEC.md)。

---

## 📂 项目结构

```text
aot-relase-apk/
├── server.js                     # Node.js 原生 HTTP 服务与静态资源/API 网关（零外部 npm 依赖，开箱即用）
├── package.json                  # 启动、发布与测试命令脚本
├── README.md                     # 项目使用说明文档
├── sample-debug.apk              # 供本地测试拖拽上传与发布的示例 APK 文件
├── docs/
│   └── THIRD_PARTY_SPEC.md       # 第三方开发者接入与 GitHub Release 发布规范 SOP 手册
├── scripts/
│   └── publish-release.js        # 自动化 GitHub Release 发布 CLI 脚本 (支持 --dry-run)
├── services/
│   ├── releaseService.js         # 本地自增 release-N 打包与邮件通知引擎
│   └── githubReleaseService.js   # GitHub Release 规范校验引擎与 REST API 客户端
├── data/
│   ├── releases.json             # 持久化元数据库 (Release 列表、GitHub 配置与邮件配置)
│   └── uploads/                  # 实际落盘的各个 release-N APK 文件目录
├── public/                       # 前端单页面应用 (现代响应式 UI，无外部框架依赖)
│   ├── index.html                # 主界面（推送打包、Release 列表、邮件中心、GitHub 规范发布、Monitor 模拟器）
│   ├── css/
│   │   └── style.css             # 样式表
│   └── js/
│       └── app.js                # 客户端交互逻辑（文件上传、GitHub 发布校验、Monitor 更新对话框渲染）
└── test/
    ├── test-engine.js            # 自动化测试套件：自增 release-N 与邮件触发
    ├── test-github-release.js    # 自动化测试套件：第三方规范与 GitHub Release 规则全量校验
    └── test-server-api.js        # 自动化测试套件：Server HTTP API 内存集成测试
```

---

## 🚀 快速启动

本项目采用纯原生 Node.js 构建，**不需要安装第三方 npm 包**，任意环境均可秒级启动：

```bash
# 启动 Release 发布平台服务
node server.js
```

启动成功后，在浏览器访问：  
👉 **http://localhost:3000**

### 命令行一键发布 (CLI)

```bash
# 本地 Dry-run 模拟校验 (无需 Token)
node scripts/publish-release.js --version 1.0.0 --changelog "首发版本" --latest --dry-run

# 真实发布至 GitHub (需配置 GITHUB_TOKEN)
export GITHUB_TOKEN=ghp_xxxx
node scripts/publish-release.js --apk ./sample-debug.apk --version 1.0.0 --package com.zhijiayun.aot --changelog "1. 适配门市云端 App 下载" --latest
```

---

## 🧪 自动化测试验证

运行内置的全套自动化测试套件：

```bash
# 1. 验证 release-N 自增与邮件触发
node test/test-engine.js

# 2. 验证第三方发布规范 (Tag/Asset/Latest/Body 4 大规则全覆盖)
node test/test-github-release.js

# 3. 验证 HTTP API 接口集成 (内存零网络依赖测试)
node test/test-server-api.js
```

---

## 📡 RESTful API 接口说明

| 请求方法 | 接口路径 | 说明 |
| :--- | :--- | :--- |
| `POST` | `/api/github/release` | 严格遵守第三方规范发布 GitHub Release (支持文件上传与 Dry-run) |
| `GET` | `/api/github/check-update` | 模拟 Monitor 检查目标仓库是否有新版本及更新对话框内容 |
| `GET/POST`| `/api/github/config` | 查询与配置 GitHub 目标仓库 (`owner/repo`)、默认包名与 Token |
| `GET` | `/api/releases` | 获取所有本地 Release 包列表、统计数据及下一个编号 |
| `POST` | `/api/releases/upload` | 上传 APK 文件（`multipart/form-data`），自动打包 `release-N` 并触发邮件通知 |
| `GET` | `/api/releases/:id/download` | 实际下载对应的 `release-N.apk` 安装包 |
| `POST` | `/api/releases/:id/resend-email` | 为指定的 Release 包重新派发邮件通知 |
| `DELETE` | `/api/releases/:id` | 删除指定的 Release 包及对应磁盘文件 |
| `GET/POST`| `/api/email/settings` | 查询与更新邮件通知触发配置 |
| `GET` | `/api/email/logs` | 获取历史邮件通知推送记录清单 |
