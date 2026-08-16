# DengTa home frontend

DengTa home 的 React + Vite 前端，包含聊天、会话、朋友圈、Supabase 对话摘要、Ombre 记忆浏览和 PWA 安装支持。

## 本地运行

只使用 CMD：

```cmd
npm install
npm run dev
```

默认本地后端地址为 `http://localhost:3000`。本地开发可复制 `.env.example` 为 `.env.local`；生产构建应由部署平台在构建时注入环境变量，不要把生产地址或密钥提交到仓库。

## 检查

```cmd
npm run lint
npm run build
```

旧版单接口设置现在也提供 OpenAI Responses 与推理强度选择。Responses 会把
`xhigh` 作为 `reasoning.effort` 发送；保留函数工具的 Chat 兼容接口只允许
`none`。多供应商控制台和旧版设置页共用同一套校验规则。

## Android

Android 原生壳使用 Capacitor，应用编号为 `home.dengta.app`，最低支持 Android 12（API 31）。

一条命令构建 APK（先在 `.env.local` 填好 `VITE_API_URL`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`）：

```cmd
powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1
```

Linux 与 macOS 用 `npm run android:apk`。只想同步网页资源时仍可单独执行 `npm run build` 与 `npm run android:sync`。

仓库根目录的 `.github/workflows/android-apk.yml` 可手动构建调试版 APK，并上传名为 `DengTa-home-android-debug` 的构建产物。运行前需在 GitHub Repository Secrets 配置 `VITE_API_URL`、`VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`；Gradle 会复用 `VITE_API_URL` 生成原生后台服务地址。调试版仅用于测试，正式发布前需要单独配置发布签名。

后端必须是 `https://`：安卓壳设置了 `cleartext: false`，不会连接明文地址。完整部署与安装说明见 [docs/ANDROID.md](../docs/ANDROID.md)。

## 密钥

API Key、Ombre Token、Dashboard 密码和 Supabase Secret 都不得写入本仓库。它们只保存在相应后端部署平台的环境变量中。
