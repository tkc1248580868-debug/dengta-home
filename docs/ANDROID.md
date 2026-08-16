# 把 DengTa Home 装到安卓手机上

DengTa Home 的安卓端是 Capacitor 原生壳 + React 网页包，应用编号 `home.dengta.app`。
本文覆盖从零到手机上能打开应用的完整流程。

## 0. 先决条件

| 项目 | 要求 |
| --- | --- |
| 手机系统 | Android 12（API 31）或更高 |
| 后端 | 已部署并可从公网访问的 `backend/`，必须是 `https://` |
| 数据库 | 已按编号执行完 `backend/supabase/` 全部迁移的 Supabase 项目（见下） |
| 本地构建（可选） | Node.js 24、JDK 21、Android SDK（platform 36、build-tools 36） |

### 执行数据库迁移

`backend/supabase/` 下有 27 个 SQL 文件，必须按编号顺序执行。两种方式：

- **在 Supabase 后台**：SQL Editor 里依次粘贴执行。
- **用 GitHub Actions**（不必手工粘贴，适合只有手机的情况）：添加两个 Repository Secret，
  然后运行 `Apply Supabase migrations` 工作流，在 `confirm` 里填 `apply`。

  | Secret | 值 |
  | --- | --- |
  | `SUPABASE_DB_URL` | Supabase `Connect` 对话框里的连接串，**照抄即可**，`[YOUR-PASSWORD]` 占位符不用管 |
  | `SUPABASE_DB_PASSWORD` | 数据库密码本身 |

  连接串**必须选 Session pooler 那一条** —— GitHub 运行器只有 IPv4，而 Supabase 的
  直连主机是 IPv6-only。工作流会把密码 URL 编码后填进占位符，所以密码里带
  `@ : / # ? &` 之类的字符也不会破坏连接串；连接串和密码都不会出现在日志里。
  跑完的摘要会报告建了多少张表、多少张启用了行级安全，两个数字都应是 34。

迁移文件都写成了可重复执行的形式，重复跑不会破坏已有数据。

**后端必须是 HTTPS。** 安卓壳在 `frontend/capacitor.config.json` 里设置了
`cleartext: false` 与 `allowMixedContent: false`，应用不会连接 `http://` 地址。
在手机上调试局域网后端时，请给它配置一个证书受信任的 HTTPS 域名，或使用内网穿透工具，
不要改成明文——那会让账号令牌在同网段内可被读取。

构建 APK 需要三个值，它们在构建时被写进包里：

```dotenv
VITE_API_URL=https://your-backend.example.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_your_anon_key
```

`VITE_API_URL` 会同时作为 `DENGTA_BACKEND_API_URL` 传给 Gradle，供原生后台通知与
共看服务使用。两者不一致时，网页部分能连上后端，但后台通知会静默失败。
anon key 属于客户端公开值，但必须配合已经启用并测试过的 Row Level Security。

## 1. 获取 APK

三选一。不想装安卓开发环境就用方式 A。

### 方式 A：GitHub Actions（无需本地环境）

1. 在仓库 `Settings → Secrets and variables → Actions` 添加三个 Repository Secret：
   `VITE_API_URL`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。
2. 打开 `Actions → Build Android APK → Run workflow`，选择分支后运行。
   `publish_release` 默认开启。
3. 等待约 10 分钟，然后二选一取包：
   - **手机上推荐**：仓库首页右侧 `Releases` → 最新那条 → 点 `.apk` 附件直接下载安装，不用解压。
   - 或在该次运行页面底部下载构建产物 `DengTa-home-android-debug`（zip 内是 `app-debug.apk`）。

只想要构建产物、不想每次生成 Release 时，运行前把 `publish_release` 取消勾选即可。

工作流会先跑完整前端测试与 lint，再构建、同步、打包并校验 APK 签名，
所以任何一步失败都会中止而不会产出半成品包。

### 方式 B：本地一条命令

先在 `frontend/.env.local` 里填好上面三个变量（可从 `.env.example` 复制），
并确保 `ANDROID_HOME` 指向 Android SDK，然后：

```bash
cd frontend
npm ci
scripts/build-android.sh
```

Windows：

```cmd
cd frontend
npm ci
powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1
```

脚本会依次检查工具链与环境变量、构建网页包、执行 `cap sync`、调用 Gradle，
最后打印 APK 路径。默认构建 debug 版；`scripts/build-android.sh release`
构建发布版（需要先配好第 4 节的签名）。

### 方式 C：手动分步 / Android Studio

```bash
cd frontend
npm ci
npm run build
npm run android:sync
cd android
DENGTA_BACKEND_API_URL="$VITE_API_URL" ./gradlew assembleDebug
```

Windows 用 `gradlew.bat assembleDebug`。
也可以用 Android Studio 打开 `frontend/android` 目录，连上手机后直接点运行，
但仍需先执行 `npm run build && npm run android:sync`，否则壳里装的是上一次的网页包。

产物固定在：

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

## 2. 安装到手机

**USB 方式（推荐）**：手机开启「开发者选项 → USB 调试」，连上电脑后：

```bash
adb install -r frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

`-r` 表示覆盖安装并保留数据。

**直接传文件**：把 APK 通过网盘、数据线或聊天工具发到手机，用文件管理器点击安装。
系统会提示「未知来源应用」，需要为该文件管理器单独授予安装权限。
部分国产 ROM 还会做安装二次确认或应用扫描，按提示允许即可。

调试版与发布版使用不同签名，不能互相覆盖安装；换版本前需要先卸载旧的。

## 3. 首次启动

1. 打开应用，用 Supabase 账号注册或登录。
2. 在应用内的 AI 供应商设置里填写自己的模型 API Key——密钥保存在账号维度，
   不会写进 APK，也不经过仓库。
3. 按需授予权限：通知（主动消息）、麦克风（语音）、位置（天气背景）。
   共看功能依赖屏幕录制授权与「使用情况访问」，这两项默认关闭，
   只有在你主动开启后才会采集，不需要就不要授权。

## 4. 发布签名（可选）

调试版每次由本机调试密钥签名，适合自用；要长期使用或跨机器更新，建议改用发布签名。

生成密钥库（放在仓库之外，例如个人目录）：

```bash
keytool -genkey -v -keystore dengta-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias dengta
```

在 `frontend/android/keystore.properties` 写入：

```properties
storeFile=/absolute/path/to/dengta-release.jks
storePassword=...
keyAlias=dengta
keyPassword=...
```

该文件与 `*.jks`、`*.keystore`、`*.p12` 已被 `.gitignore` 排除，仓库审计脚本也会拦截它们。
**密钥库丢失就无法再更新已安装的应用**，请单独备份。

配好后运行 `scripts/build-android.sh release`，产物在
`frontend/android/app/build/outputs/apk/release/app-release.apk`。
没有 `keystore.properties` 时发布构建不会启用签名配置，产出的是未签名包，无法安装。

## 5. 排查

| 现象 | 原因与处理 |
| --- | --- |
| 应用白屏或停在启动图 | 网页包没同步。重新执行 `npm run build && npm run android:sync` 再打包 |
| 登录报网络错误 | `VITE_API_URL` 写错、后端未启动，或后端 CORS 未放行；后端 `FRONTEND_URL` 需要包含应用来源 |
| 能聊天但收不到主动通知 | 打包时没传 `DENGTA_BACKEND_API_URL`，原生服务指向了占位地址。用第 1 节的脚本可避免 |
| 安装时提示「应用未安装」 | 已装同包名但签名不同的版本，先卸载旧版 |
| Gradle 报找不到 SDK | 未设 `ANDROID_HOME`，或 `frontend/android/local.properties` 里 `sdk.dir` 有误 |
| Gradle 报 SDK 版本缺失 | 用 sdkmanager 安装 `platforms;android-36` 与 `build-tools;36.0.0` |
| 手机系统低于 Android 12 | 不支持。`minSdkVersion` 为 31 |

更完整的服务端与数据库部署说明见 [DEPLOYMENT.md](DEPLOYMENT.md)。
