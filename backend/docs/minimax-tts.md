# MiniMax 情绪语音部署

DengTa Home 的 MiniMax 文字转语音只运行在主后端：

```text
AI 文字回复
  -> POST /voice/speech
  -> MiniMax T2A v2
  -> 成功时 MP3 返回手机
  -> 失败时仅保留文字回复
```

`DengTa-home-voice` 只负责麦克风录音的转写和情绪理解，不需要
`MINIMAX_API_KEY`。

## MiniMax 控制台需要准备的值

1. 登录 <https://platform.minimax.io/login>。
2. 在 API Key 页面创建一枚只供 DengTa 后端使用的密钥：
   <https://platform.minimax.io/user-center/basic-information/interface-key>。
3. 选择一个系统音色，或完成下面的声音克隆，复制它准确的
   `voice_id`。
4. 可在余额页面检查额度：
   <https://platform.minimax.io/user-center/payment/balance>。

不要把 API Key 发到聊天、截图、GitHub、前端环境变量或备份 ZIP。
只在 Render 的后端服务 Environment 页面粘贴。

## Render 环境变量

至少填写：

```text
EXPRESSIVE_TTS_PROVIDER=minimax
MINIMAX_API_KEY=<MiniMax 控制台创建的 API Key>
MINIMAX_TTS_VOICE_ID=<系统音色或克隆音色的 voice_id>
```

推荐保持：

```text
MINIMAX_TTS_URL=https://api.minimax.io/v1/t2a_v2
MINIMAX_TTS_MODEL=speech-2.8-turbo
MINIMAX_TTS_SPEED=1
MINIMAX_TTS_VOLUME=1
MINIMAX_TTS_PITCH=0
MINIMAX_TTS_VOICE_MODIFY_PITCH=0
MINIMAX_TTS_VOICE_MODIFY_INTENSITY=0
MINIMAX_TTS_VOICE_MODIFY_TIMBRE=0
MINIMAX_TTS_VOICE_MODIFY_SOUND_EFFECT=
MINIMAX_TTS_EMOTION=auto
EXPRESSIVE_TTS_TIMEOUT_MS=45000
EXPRESSIVE_TTS_MAX_CHARS=3000
EXPRESSIVE_TTS_TOKEN_TTL_SECONDS=600
EXPRESSIVE_TTS_CACHE_MAX_ENTRIES=24
EXPRESSIVE_TTS_CACHE_MAX_BYTES=25165824
```

设置完成后在 Render 点击 **Save, rebuild, and deploy**。`/health`
只返回安全状态和供应商名称，不会返回 API Key、`voice_id`、模型或接口
地址。以下三项应为 `true`：

```text
expressive_tts_configured
expressive_tts_api_key_configured
expressive_tts_voice_configured
```

`expressive_tts_device_fallback` 应为 `false`。云端自然语音失败时只保留
文字回复，不会声明其他播放方式。

## 情绪、语速和音调

- `MINIMAX_TTS_EMOTION=auto` 时请求中不发送 `emotion`，由 MiniMax
  根据整段文字自动选择。
- 留空时，后端可以从受信任的消息情绪提示和文字内容选择
  `happy`、`sad`、`angry`、`fearful`、`surprised` 或 `calm`；
  中性文字仍不发送 `emotion`。
- 也可固定为 MiniMax 支持的情绪：
  `happy`、`sad`、`angry`、`fearful`、`disgusted`、`surprised`、
  `calm`、`fluent`、`whisper`。
- `fluent` 和 `whisper` 只支持 `speech-2.6-hd` 与
  `speech-2.6-turbo`。其他模型会自动忽略这两个不兼容值。
- `MINIMAX_TTS_SPEED` 范围为 `0.5` 到 `2`。
- `MINIMAX_TTS_VOLUME` 必须大于 `0`，最大 `10`。
- `MINIMAX_TTS_PITCH` 范围为 `-12` 到 `12`。
- `MINIMAX_TTS_VOICE_MODIFY_PITCH` 范围为 `-100` 到 `100`，
  从深沉到明亮。
- `MINIMAX_TTS_VOICE_MODIFY_INTENSITY` 范围为 `-100` 到 `100`，
  从强劲到柔和。
- `MINIMAX_TTS_VOICE_MODIFY_TIMBRE` 范围为 `-100` 到 `100`，
  从饱满到清脆。
- `MINIMAX_TTS_VOICE_MODIFY_SOUND_EFFECT` 通常保持留空；可选
  `spacious_echo`、`auditorium_echo`、`lofi_telephone` 或 `robotic`。

后端会限制这些数值、移除模型输出中的控制标签、限制文字和音频大小，
并对 MiniMax 请求设置超时。上游失败会终止本轮语音生成并返回安全错误，
不会影响已经生成的文字回复。

## 语音票据与重复计费保护

自然语音接口不再只凭可枚举的消息编号调用。后端只给刚刚生成的 AI
回复签发短期票据，票据同时绑定消息编号、会话编号和过期时间：

- 票据不写入数据库、历史消息接口、日志或本地存储；
- App 会透明回传票据，不需要用户输入管理口令；
- 缺失、篡改、跨会话或过期票据都不会调用 MiniMax；
- 相同消息的并发请求会合并；
- 票据有效期内的重复播放会使用有界内存缓存，避免重复合成计费；
- 旧版 APK 缺少票据时后端不会调用 MiniMax，已生成的文字聊天仍然可用。

默认票据有效 10 分钟，音频缓存最多 24 条且总计不超过 24 MiB。
Render 重启时缓存自动清空。若设置独立的
`EXPRESSIVE_TTS_ACCESS_SECRET`，应使用至少 32 字节随机值且只放在
Render；留空时后端会从现有 `SUPABASE_SECRET_KEY` 做域隔离派生。

## 用提示词设计并试听音色

MiniMax 的正式 T2A 朗读接口没有自然语言提示词字段。音色提示词属于独立的
Voice Design 接口：输入一段声音描述和不超过 500 字的试听文本，返回试听 MP3
以及可供正式朗读使用的 `voice_id`。

本项目只提供本机命令，不开放公网 Voice Design 接口，避免他人触发计费。
官方说明试听文本按字符计费，运行命令前应先检查余额和当期价格。

先执行零费用待命检查。它只读取并校验本地 `prompt.txt`、
`preview.txt`、可选 `voice_id` 和命令参数；不会读取 API Key、不会联网、
不会创建目录或写入文件，也不会调用 MiniMax：

```cmd
npm run minimax:prepare-voice -- --prompt-file voice-design.local\prompt.txt --preview-file voice-design.local\preview.txt
```

输出必须明确包含 `网络请求: 未发送`、`API Key: 未读取` 和
`计费条件: 未确认`。预检通过只代表本地内容已准备好，并不代表余额、接口权限
或网络已经验证。

充值并再次确认当期价格后，才在 Backend 目录的 CMD 中执行一次付费命令：

```cmd
mkdir voice-design.local
notepad voice-design.local\prompt.txt
notepad voice-design.local\preview.txt
set "MINIMAX_API_KEY=只在当前终端临时填写"
npm run minimax:design-voice -- --prompt-file voice-design.local\prompt.txt --preview-file voice-design.local\preview.txt --confirm-billing
set "MINIMAX_API_KEY="
```

`--prepare` 与 `--confirm-billing` 严格互斥；不写模式、同时写两个模式、参数
缺值、参数重复或未知参数都会在读取密钥和发送请求前失败。真实生成命令每执行
一次都可能产生一次费用，不要在失败重试工具或循环脚本中调用。

`voice-design.local` 已被 Git 忽略。命令不会打印 API Key 或提示词，只会输出：

- MiniMax 返回的 `voice_id`；
- 本地试听 MP3 路径；
- 下一步应配置的 Render 变量名。

建议提示词描述稳定的声音身份，例如年龄感、音色、自然程度、亲密距离、
语速倾向和是否避免播音腔。不要把每轮剧情或人物系统提示词放进去；每句话的
情绪仍由 `MINIMAX_TTS_EMOTION=auto` 或后端消息情绪控制。

每轮只修改一个变量，使用同一段包含陈述、疑问、轻笑、安慰和晚安语气的试听
文本对比。试听满意后，把最终 `voice_id` 填进 Render 的
`MINIMAX_TTS_VOICE_ID`。不需要把 API Key 或试听文件发给代码模型。

Voice Design 官方接口：
<https://platform.minimax.io/docs/api-reference/voice-design-design>

## 克隆自己的音色

声音克隆不是自动上传流程，必须由项目所有者主动完成。

- 源音频：MP3、M4A 或 WAV。
- 时长：10 秒到 5 分钟。
- 文件大小：不超过 20 MB。
- 上传文件的 purpose 使用 `voice_clone`。
- 调用 `/v1/voice_clone` 时，自定义 `voice_id` 需为 8 到 256 个字符、
  以英文字母开头且保持唯一。
- 可选提示音频需短于 8 秒，purpose 使用 `prompt_audio`。
- 克隆后至少生成并使用一次；未使用的克隆音色可能在 7 天后删除。

官方说明：
<https://platform.minimax.io/docs/guides/speech-voice-clone>

不要让自动化任务自行挑选或上传私人录音。克隆完成后，只把最终
`voice_id` 填入 Render。

## 验证与排查

1. Render 部署成功后打开 `/health`，确认三个配置布尔值。
2. 在 App 中把语音播放模式切到“自然语音”。
3. 让 AI 生成一条已保存的回复并播放。
4. MiniMax 成功时响应头包含 `X-DengTa-Voice-Provider: minimax`。
5. 若没有播放出自然语音，检查 Render 日志中的安全错误文本以及
   MiniMax 余额；日志不会输出密钥。

常见原因：

- `MINIMAX_TTS_VOICE_ID` 留空或复制错误；
- API Key 无效、余额不足或账户权限未开通；
- 固定 `whisper/fluent` 却选择了非 2.6 模型；
- Render 修改环境变量后没有重新部署；
- MiniMax 上游超时，本轮不会生成音频。

T2A v2 官方接口：
<https://platform.minimax.io/docs/api-reference/speech-t2a-http>
