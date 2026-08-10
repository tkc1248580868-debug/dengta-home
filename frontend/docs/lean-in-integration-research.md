# Lean In 与 DengTa 屏幕共看集成研究

## 审计范围

- 上游仓库：[`wxynora/Lean_In`](https://github.com/wxynora/Lean_In)
- 固定提交：[`f5201a18dc639e8c53140fe6977789d17b1d8cb3`](https://github.com/wxynora/Lean_In/commit/f5201a18dc639e8c53140fe6977789d17b1d8cb3)（2026-07-23）
- 仓库没有 tag 或 GitHub Release；`pyproject.toml` 标记为 `0.1.0` / Alpha。
- 本报告只依据该提交的源码、README、仓库内文档，以及 Android 官方 API 文档。
- 未修改 DengTa 产品代码。上游 Web 辅助模块的 34 项测试已在本机通过；Python 测试未运行，因为当前环境没有 Python 3.11+ 解释器。

## 结论

Lean In 值得借鉴，但不适合整仓直接嵌入 DengTa。它是一个 **共同观看的时间轴与上下文运行时**，不是 Android 屏幕捕获或手机远控程序。它已经解决了播放器时钟、稀疏画面取样、剧情分析、回复延迟、弹幕动作、断线回收和过期任务等关键状态问题；生产网关、数据库、模型供应商、Android 原生捕获与手机控制都由宿主自行实现。上游对此有明确说明（[README 3-30](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L3-L30)、[Architecture 47-80](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/architecture.md#L47-L80)）。

对 DengTa 最合适的路线是：**保留现有 Android `MediaProjection` 屏幕共享，重新用 Node/Supabase 实现 Lean In 的协议思想和状态机**。不部署 Python 边车，不复制其 Web 页面，也不把外部 App 误当成可精确控制的播放器。

另有一个必须先处理的许可问题：上游使用 [PolyForm Noncommercial 1.0.0](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/LICENSE)，明确不允许商业使用（[README 603-607](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L603-L607)）。若 DengTa 现在或未来可能商业发布，不应复制上游代码、提示词、Schema 或 UI；应取得单独授权，或仅依据公开行为需求独立实现。若产品确定一直是许可允许的非商业用途，也仍需保留许可证与 Required Notice。

## 上游架构与真实能力

| 层 | 上游实现 | 能否直接解决 DengTa 需求 |
| --- | --- | --- |
| 时间轴核心 | Python `together_watch`；播放器时钟权威，使用 `timeline_epoch` 与单调递增 `snapshot_seq` 使 seek、换片和恢复后的旧任务失效（[README 34-50](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L34-L50)） | 可借鉴状态模型，不能直接运行在现有 Node 后端中 |
| 宿主适配器 | `PlaybackAdapter`、`ClientSampleExporter`、`AnalysisProvider`、`ContextHostAdapter`、`ActionTransport`、`RuntimeStore` 等仅定义协议（[adapters.py 76-164](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/adapters.py#L76-L164)） | DengTa 需要自行实现 |
| 画面采样 | 本地文件由隐藏 `<video>` 定位到目标时间，再画到 `<canvas>` 并导出 JPEG（[local-sampler.js 76-145](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/lib/local-sampler.js#L76-L145)） | 只适用于客户端可读的视频文件，不是系统屏幕捕获 |
| 模型分析 | 宿主把稀疏画面、字幕、短音频、前一分析窗口组织为结构化 Prompt/Schema；模型供应商保持可替换（[providers.md 83-96](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/providers.md#L83-L96)） | 可映射到 DengTa 已有自定义模型接口 |
| 聊天融合 | `ContextHostAdapter` 把当前、已看、预计回复抵达和定时未来片段交给真实聊天模型；它不定义伴侣人格，也不预生成整部作品的反应（[README 486-534](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L486-L534)） | 应作为低优先动态观看上下文，与 DengTa 当前个性化指令、记忆和会话共同发送 |
| 动作 | 核心唯一可投递的模型动作是包含 `target_ms` 和 `text` 的 `DanmakuAction`（[models.py 521-536](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/src/together_watch/models.py#L521-L536)） | 可实现定时吐槽/聊天气泡；不能据此点击手机 |
| Web 宿主桥 | 提供播放快照、画面截取、恢复位置、发消息等可选回调，但真正能力仍由宿主提供（[host.js 105-146](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/web/lib/host.js#L105-L146)） | 不是现成 Android 适配器 |
| 生命周期 | 独立客户端租约、心跳、取消点、过期采样计划和幂等结束，避免客户端离开后继续花费模型费用（[Architecture](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/docs/architecture.md)） | 很适合独立移植到 Node/Supabase |

### 它没有实现什么

1. 没有 Android 原生模块、`MediaProjection`、无障碍服务或屏幕 OCR 服务。
2. 没有生产 HTTP 网关、数据库、鉴权、队列或已配置的模型供应商。
3. 没有读取任意手机 App 的标题、封面、播放进度或字幕。
4. 没有任意点击、滑动、选择视频或控制第三方 App 的动作协议。参考客户端只控制自己的 HTML `<video>`；`ActionTransport` 只发送经过验证的弹幕。
5. 浏览器端明确报告 `can_export_audio=false`（[README 351-362](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/README.md#L351-L362)），不能直接理解第三方播放器的声音或对白。
6. 没有输出模型隐藏思维链。它提供的是结构化剧情上下文与可见反应，不应将生成的“内心想法”描述成供应商模型的真实隐藏推理。

## DengTa 当前基础

DengTa 已有的屏幕共看链路比 Lean In 更接近 Android 落地：

- [`ScreenGlancePlugin.java`](../android/app/src/main/java/home/dengta/app/ScreenGlancePlugin.java) 每次会话通过 Android 系统授权页取得 `MediaProjection`。
- [`ScreenGlanceService.java`](../android/app/src/main/java/home/dengta/app/ScreenGlanceService.java) 运行前台服务，以 `VirtualDisplay + ImageReader` 读取画面，缩放后压成单帧 JPEG；支持手动、随机、暂停、恢复、结束和常驻通知。
- [`screen-glance.js`](../src/screen-glance.js) 将一次捕获转成图片附件；[`App.jsx`](../src/App.jsx) 取走后将原图从本机删除，再发起一次普通聊天回合。

当前缺口是：它只保留“最新一帧”，随机间隔是分钟级，没有连续观看会话、画面变化检测、媒体时间、批量稀疏取样、场景摘要、反应节流或观看记录；同时也没有 `AccessibilityService`、媒体控制会话或任意触摸实现。

Android 官方说明也限定了能力边界：`MediaProjection` 每次会话需要用户同意，并需在媒体投影类型的前台服务中运行（[Media projection](https://developer.android.com/media/grow/media-projection)）；它捕获屏幕像素，不赋予点击能力。触摸手势属于单独的 `AccessibilityService.dispatchGesture()` 能力并需要在服务元数据中声明（[AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#dispatchGesture(android.accessibilityservice.GestureDescription,%20android.accessibilityservice.AccessibilityService.GestureResultCallback,%20android.os.Handler))）。DengTa 当前没有这项服务。

## 推荐落地结构

### 第一阶段：把“看一会儿”接到现有屏幕共享

1. **互动入口**：动态状态栏的“看一会儿”进入共看准备页；由用户启动现有系统屏幕共享，成功后创建 `watch_session`。
2. **原生模式**：为 `ScreenGlanceService` 增加 `glance` 与 `watch` 两种模式。`glance` 保持现状；`watch` 在同一投影会话内按短间隔取样，不新建第二套权限链路。
3. **省流量取样**：在手机本地先缩图并计算感知哈希；画面变化不足时不上传。发生明显变化时，每批最多提交 1–3 张稀疏帧，而不是传输视频流。
4. **外部屏幕时间轴**：由于第三方播放器进度不可得，使用“共享会话经过时间”而不是伪造影片时间；旋转屏幕、切换前台 App、暂停和恢复时增加 `screen_epoch`，每帧增加 `snapshot_seq`。
5. **后端分析**：后台任务把稀疏帧生成结构化 `scene_summary`、`visible_title_guess`、`companion_feeling`、`reaction_text` 和 `confidence`。标题与作品身份必须显示为模型推断，不能当作已读取的媒体元数据。
6. **伴侣反应**：只有内容显著变化且伴侣确实“想说”时，才生成一条短聊天气泡、悬浮弹幕或本地通知。模型提示仍从 DengTa 当前个性化指令、记忆、伴侣状态和本次观看上下文汇编；Lean In 上下文不替换人格层。
7. **会话控制**：保留常驻通知中的暂停、继续和结束；应用回到前台时展示已看时长、最近场景、上次反应和本次模型调用次数。

### 第二阶段：精确影片共看

若视频由 DengTa 内置播放器或可控 Web 播放器播放，再实现 Lean In 的精确模式：

- 真实 `playhead_ms`、`is_playing`、`playback_rate`；
- seek/换片后使旧分析和定时反应失效；
- 本地视频隐藏读取器按服务端采样计划抽帧；
- 字幕与剧情窗口对齐；
- 按 `target_ms` 显示弹幕式反应；
- “AI 暂停/继续”只调用这个受控播放器，不模拟手机触摸。

这是最接近 Lean In 原设计、也最能保证同步精度的路径。

### 第三方 App 控制的单独决策

“AI 自己点击手机、选择节目、暂停第三方视频”不属于 Lean In，也不能由 `MediaProjection` 实现。若未来仍要开发，必须另选技术路径并真机验证：

- 优先尝试 Android 媒体会话提供的播放/暂停能力；它只覆盖主动暴露媒体会话的播放器。
- 任意坐标点击需要新建无障碍服务；屏幕文字节点、WebView、游戏画面和自绘播放器不保证可读，坐标也会受旋转、弹窗和界面更新影响。
- DRM/安全窗口可能返回黑屏，系统或来源 App 也可能禁止捕获；因此“读取手机上的所有东西”无法作为可验收承诺。

建议在精确共看可用前，不让模型直接操作第三方 App。可以先让它提出“我想暂停一下”“我想看这个封面”的可见建议，由用户完成操作；这不会阻塞屏幕共享、场景理解和实时反应的主体体验。

## 数据与接口建议

| 模块 | 最小字段/接口 |
| --- | --- |
| `watch_sessions` | `id, user_id, companion_id, mode, started_at, ended_at, lease_expires_at, screen_epoch, latest_seq` |
| `watch_samples` | `session_id, epoch, seq, captured_at, perceptual_hash, object_path, expires_at`；原始帧短期存储，分析后删除 |
| `watch_chunks` | `session_id, epoch, start_ms, end_ms, scene_summary, work_guess, confidence` |
| `watch_actions` | `session_id, epoch, target_elapsed_ms, kind, text, status, idempotency_key` |
| App → 后端 | 创建/心跳/暂停/恢复/结束会话、提交稀疏帧、获取待显示反应 |
| 后端 → App | 短聊天气泡、定时弹幕、本地通知；每项绑定 session/epoch/seq，避免迟到反应串场 |

成本控制应放在模型调用之前：本地变化检测、同场景哈希去重、每批少量帧、先结构化分析后按需让主聊天模型发言、限制无意义反应频率、同一场景复用摘要。这样才能比“每隔数秒把整张屏幕直接发给最高档模型”稳定且省费用。

## 可复用清单与阻塞项

**建议独立重写并保留语义：** `timeline_epoch/snapshot_seq`、客户端租约、采样计划、媒体修订号、后台任务取消点、上下文分区、回复延迟校准、幂等定时反应和会话内剧情召回。

**不建议直接引入：** Python 包、Web UI、上游提示词与 JSON Schema、风险遮罩模块、Bilibili 专用解析、票根系统。它们不是本轮核心需求，并且直接复制受非商业许可证约束。

**上线前阻塞项：**

1. 明确 DengTa 是否可能商业发布，并据此决定取得许可或 clean-room 独立实现。
2. 确定第一版只支持“系统屏幕的稀疏视觉共看”，还是同时增加 DengTa 内置播放器。
3. 设计后台任务、Supabase 表和短期对象存储；Lean In 未提供这些生产组件。
4. 在真实手机上验证横竖屏、锁屏、前后台、DRM 黑屏、系统撤销投影、长时间耗电和网络恢复。
5. 若第一版必须理解对白，需另行确定播放音频捕获或字幕来源；上游浏览器参考端只有画面降级路径。
6. 单独决定是否开发媒体会话/无障碍控制；不能把它混入现有截图插件后宣称已经可以控制手机。

## 验证记录

- 上游 Web：`npm test`，34/34 通过。
- 上游 Python：未运行；本机无 Python 3.11+。仓库 CI 声明在 Python 3.11 与 3.13 上运行单元测试与编译，但本报告未把 CI 配置本身当作通过证据（[ci.yml](https://github.com/wxynora/Lean_In/blob/f5201a18dc639e8c53140fe6977789d17b1d8cb3/.github/workflows/ci.yml)）。
- Android：上游没有 Android 工程，因此不存在可直接安装或真机验证的 Lean In APK。
