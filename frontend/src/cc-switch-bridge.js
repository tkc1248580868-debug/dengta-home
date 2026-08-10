const TARGETS_BY_PROTOCOL = {
  "openai-chat": [
    {
      value: "opencode",
      label: "OpenCode（推荐）",
      help: "OpenAI Chat 兼容接口适合导入 OpenCode。",
    },
    {
      value: "openclaw",
      label: "OpenClaw",
      help: "按 OpenAI Chat 兼容接口导入 OpenClaw。",
    },
    {
      value: "hermes",
      label: "Hermes",
      help: "按 chat_completions 模式导入 Hermes。",
    },
  ],
  "openai-responses": [
    {
      value: "codex",
      label: "Codex（推荐）",
      help: "CC Switch 会按 Responses 协议生成 Codex provider。",
    },
  ],
  anthropic: [
    {
      value: "claude",
      label: "Claude Code（推荐）",
      help: "按 Anthropic 原生接口导入 Claude Code。",
    },
  ],
  gemini: [
    {
      value: "gemini",
      label: "Gemini CLI（推荐）",
      help: "按 Gemini 原生接口导入 Gemini CLI。",
    },
  ],
};

function text(value) {
  return String(value || "").trim();
}

function bridgeError(message) {
  const error = new Error(message);
  error.name = "CcSwitchBridgeError";
  return error;
}

export function ccSwitchTargetsForProtocol(protocol) {
  return TARGETS_BY_PROTOCOL[protocol] || TARGETS_BY_PROTOCOL["openai-chat"];
}

export function buildCcSwitchDeepLink({
  name,
  protocol,
  baseUrl,
  apiKey,
  model,
  targetApp,
}) {
  const normalizedName = text(name);
  const normalizedBaseUrl = text(baseUrl).replace(/\/+$/, "");
  const normalizedApiKey = text(apiKey);
  const supportedTargets = ccSwitchTargetsForProtocol(protocol);
  const target = supportedTargets.find((item) => item.value === targetApp);

  if (!normalizedName) throw bridgeError("请先填写接口显示名称。");
  if (!/^https?:\/\/[^/\s]+/i.test(normalizedBaseUrl)) {
    throw bridgeError("Base URL 必须是完整的 http 或 https 地址。");
  }
  if (!normalizedApiKey) {
    throw bridgeError("CC Switch 3.17.0 导入供应商时要求填写 API Key。");
  }
  if (!target) {
    throw bridgeError("当前协议不能导入到所选目标工具。");
  }

  const params = new URLSearchParams({
    resource: "provider",
    app: target.value,
    name: normalizedName,
    endpoint: normalizedBaseUrl,
    apiKey: normalizedApiKey,
    enabled: "false",
    notes: "由 DengTa Home 本机桥接生成；导入后请先测试，再手动启用。",
  });
  const normalizedModel = text(model);
  if (normalizedModel) params.set("model", normalizedModel);

  return "ccswitch://v1/import?" + params.toString();
}

function safeFilePart(value) {
  const normalized = text(value)
    .split("")
    .map((character) => (
      character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character)
        ? "-"
        : character
    ))
    .join("")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.slice(0, 48) || "provider";
}

export function ccSwitchBridgeFileName(profile) {
  return "DengTa-CCSwitch-" + safeFilePart(profile?.name) + ".html";
}

export function buildCcSwitchBridgeHtml(profile, targetApp) {
  const targets = ccSwitchTargetsForProtocol(profile?.protocol);
  const selectedTarget = targets.find((item) => item.value === targetApp) || targets[0];
  const payload = {
    name: text(profile?.name),
    protocol: text(profile?.protocol),
    baseUrl: text(profile?.base_url),
    model: text(profile?.default_model),
    targetApp: selectedTarget.value,
  };
  const serialized = JSON.stringify(payload).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DengTa · CC Switch 本机桥接</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:28px 16px;background:#f3f0ec;color:#282425;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.shell{width:min(100%,620px);margin:0 auto;background:#fff;border:1px solid #ded7d2;border-radius:8px;box-shadow:0 14px 36px rgba(62,45,49,.09);overflow:hidden}.head{padding:22px 24px;border-bottom:1px solid #e9e3df;background:#282425;color:#fff}.head span{display:block;margin-bottom:5px;color:#e5bec9;font-size:12px}.head h1{margin:0;font-size:22px;letter-spacing:0}.body{display:grid;gap:18px;padding:24px}.facts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fact{min-width:0;padding:12px;border:1px solid #e8e1dd;border-radius:6px;background:#faf8f6}.fact small{display:block;margin-bottom:4px;color:#8c8183}.fact strong{display:block;overflow-wrap:anywhere}label{display:grid;gap:7px;font-weight:700}input{width:100%;min-height:44px;padding:10px 12px;border:1px solid #cfc5c1;border-radius:6px;font:inherit}input:focus{outline:2px solid #c4899a;outline-offset:1px}.note,.status{margin:0;padding:12px 14px;border-left:3px solid #b46f84;background:#f8eef1;color:#5f5557;line-height:1.6}.actions{display:flex;flex-wrap:wrap;gap:10px}button{min-height:42px;padding:9px 15px;border:1px solid #282425;border-radius:6px;background:#282425;color:#fff;font:inherit;font-weight:700;cursor:pointer}button.secondary{background:#fff;color:#282425}a{color:#9e4f69}.status{display:none}.status.show{display:block}@media(max-width:520px){.facts{grid-template-columns:1fr}.body,.head{padding:18px}}
</style>
</head>
<body>
<main class="shell">
  <header class="head"><span>DENGTA LOCAL BRIDGE</span><h1>导入 CC Switch</h1></header>
  <section class="body">
    <div class="facts">
      <div class="fact"><small>接口名称</small><strong id="name"></strong></div>
      <div class="fact"><small>目标工具</small><strong id="target"></strong></div>
      <div class="fact"><small>Base URL</small><strong id="base"></strong></div>
      <div class="fact"><small>默认模型</small><strong id="model"></strong></div>
    </div>
    <label>网关 API Key
      <input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="只在这台电脑本地临时使用">
    </label>
    <p class="note">这个文件没有保存你的密钥。点击导入后，CC Switch 会先显示配置预览；请检查地址和模型，再确认导入。导入项默认不启用，不会自动替换当前配置。</p>
    <p class="status" id="status" role="status"></p>
    <div class="actions">
      <button id="open" type="button">打开 CC Switch 确认导入</button>
      <button id="copy" type="button" class="secondary">复制一次性导入链接</button>
    </div>
    <small>没有安装或无法打开时，访问 <a href="https://github.com/farion1231/cc-switch/releases" target="_blank" rel="noreferrer">CC Switch 官方 Releases</a>。只使用官方仓库。</small>
  </section>
</main>
<script>
const profile=${serialized};
const labels={codex:"Codex",opencode:"OpenCode",openclaw:"OpenClaw",hermes:"Hermes",claude:"Claude Code",gemini:"Gemini CLI"};
const byId=(id)=>document.getElementById(id);
byId("name").textContent=profile.name||"未命名接口";
byId("target").textContent=labels[profile.targetApp]||profile.targetApp;
byId("base").textContent=profile.baseUrl||"未填写";
byId("model").textContent=profile.model||"由服务商决定";
function show(message){byId("status").textContent=message;byId("status").classList.add("show")}
function makeLink(){
  const apiKey=byId("key").value.trim();
  if(!apiKey){show("请先粘贴网关 API Key。");byId("key").focus();return null}
  if(!/^https?:\\/\\/[^/\\s]+/i.test(profile.baseUrl)){show("Base URL 不是完整的 http 或 https 地址。");return null}
  const params=new URLSearchParams({resource:"provider",app:profile.targetApp,name:profile.name,endpoint:profile.baseUrl.replace(/\\/+$/,""),apiKey,enabled:"false",notes:"由 DengTa Home 本机桥接生成；导入后请先测试，再手动启用。"});
  if(profile.model)params.set("model",profile.model);
  return "ccswitch://v1/import?"+params.toString()
}
byId("open").addEventListener("click",()=>{const link=makeLink();if(link){show("正在打开 CC Switch。请在应用里核对并确认。");location.href=link}});
byId("copy").addEventListener("click",async()=>{const link=makeLink();if(!link)return;try{await navigator.clipboard.writeText(link);show("一次性链接已复制。它包含 API Key，请勿发送给别人，用完后覆盖剪贴板。")}catch{show("浏览器不允许复制。请使用“打开 CC Switch”按钮。")}});
</script>
</body>
</html>`;
}
