export const GROQ_EXPIRY_STORAGE_KEY = "dengta_groq_key_expires_at";

export const SERVICE_LINKS = Object.freeze({
  backend: import.meta.env?.VITE_RENDER_DASHBOARD_URL || "",
  database: import.meta.env?.VITE_SUPABASE_DASHBOARD_URL || "",
  groq: "https://console.groq.com/keys",
  groqUsage: "https://console.groq.com/dashboard",
  minimax: "https://platform.minimax.io/user-center/payment/billing",
});

function statusCard(id, name, status, summary, detail, link, linkLabel) {
  return { id, name, status, summary, detail, link, linkLabel };
}

export function describeExpressiveTts(features = {}) {
  const configured = features.expressive_tts_configured === true;
  const apiKeyConfigured = features.expressive_tts_api_key_configured;
  const voiceConfigured = features.expressive_tts_voice_configured;
  const provider = features.expressive_tts_provider || "MiniMax";

  if (configured) {
    return {
      stage: "ready",
      status: "online",
      summary: `已连接 ${provider}`,
      detail:
        "AI 回复可使用云端情绪语音；实际费用由 MiniMax 套餐或余额决定。",
      settingsText:
        "MiniMax 自然语音已连接：会根据 AI 回复选择较合适的情绪后播放；云端失败时本轮只显示文字。",
    };
  }

  if (apiKeyConfigured === true && voiceConfigured !== true) {
    return {
      stage: "awaiting_voice",
      status: "pending",
      summary: "密钥已就绪，等待生成音色",
      detail:
        "还缺 Voice Design 返回的 Voice ID；生成前不会调用 MiniMax，也不会影响文字聊天和语音理解。",
      settingsText:
        "MiniMax 密钥已安全连接，正在等待 Voice Design 生成音色；在 Voice ID 配置完成前只显示文字。",
    };
  }

  if (apiKeyConfigured === false || voiceConfigured === true) {
    return {
      stage: "incomplete",
      status: "pending",
      summary: "服务器语音配置不完整",
      detail:
        "请检查 MiniMax API Key 与 Voice ID；当前只显示文字，不会影响文字聊天和语音理解。",
      settingsText:
        "MiniMax 服务器配置还不完整；现在选择自然语音时本轮只显示文字。",
    };
  }

  return {
    stage: "legacy_pending",
    status: "pending",
    summary: "尚未配置自然语音",
    detail:
      "服务器未返回细分配置状态；当前不会产生 MiniMax 费用，也不会影响文字聊天和语音理解。",
    settingsText:
      "MiniMax 自然语音接口已经预留，但服务器尚未报告完整配置；当前只显示文字。",
  };
}

export function buildServiceStatusCards({
  health,
  settings,
  hasLoadedSettings,
  isOnline,
  error,
}) {
  const backendOnline = isOnline && health?.ok === true;
  const features = health?.features || {};
  const providerValid = health?.configuration?.provider_pins_valid !== false;
  const providerReady =
    backendOnline &&
    providerValid &&
    Boolean(settings?.api_url && settings?.model);
  const expressiveTts = describeExpressiveTts(features);

  return [
    statusCard(
      "backend",
      "DengTa 后端",
      backendOnline ? "online" : error ? "error" : "checking",
      backendOnline ? "服务器在线" : error || "正在检查服务器",
      backendOnline
        ? `版本 ${health?.version || "未知"} · 本次检查已收到 HTTP 200`
        : "聊天、设置和语音都需要先连接后端。",
      SERVICE_LINKS.backend,
      "打开 Render",
    ),
    statusCard(
      "database",
      "Supabase 数据库",
      backendOnline && hasLoadedSettings ? "online" : "checking",
      backendOnline && hasLoadedSettings ? "读写链路可用" : "等待应用数据回读",
      hasLoadedSettings
        ? "服务器设置和会话列表已成功读取；本页面不会显示数据库密钥。"
        : "如果这里长期停留在等待状态，请检查 Supabase 项目和后端环境变量。",
      SERVICE_LINKS.database,
      "打开 Supabase",
    ),
    statusCard(
      "provider",
      "当前聊天模型",
      providerReady ? "online" : providerValid ? "pending" : "error",
      providerReady
        ? `${settings.provider || "自定义接口"} · ${settings.model}`
        : providerValid
          ? "接口或模型尚未完整填写"
          : "服务器检测到接口配置冲突",
      providerReady
        ? "模型调用仍按实际供应商额度计费；这里不会读取或显示 API Key。"
        : "到“唯一的活动接口”中检查 API 地址和模型名称。",
      "",
      "",
    ),
    statusCard(
      "groq",
      "Groq 语音理解",
      features.hervoice_proxy_configured === true ? "online" : "pending",
      features.hervoice_proxy_configured === true
        ? "Voice 代理已连接"
        : "尚未连接 Voice 代理",
      features.hervoice_proxy_configured === true
        ? "可使用麦克风转写和声音情绪线索；免费额度或密钥到期仍需在 Groq 控制台查看。"
        : "需要在 Render 配置 Voice 地址与内部密钥。",
      SERVICE_LINKS.groq,
      "管理 Groq 密钥",
    ),
    statusCard(
      "minimax",
      "MiniMax 自然语音",
      expressiveTts.status,
      expressiveTts.summary,
      expressiveTts.detail,
      SERVICE_LINKS.minimax,
      "查看 MiniMax 账单",
    ),
    statusCard(
      "ombre-mcp",
      "Ombre MCP 记忆",
      features.ombre_mcp_configured === true
        ? "online"
        : features.ombre_mcp_client === true
          ? "pending"
          : "checking",
      features.ombre_mcp_configured === true
        ? "服务器地址已配置"
        : features.ombre_mcp_client === true
          ? "客户端已就绪，等待服务器"
          : "等待后端更新",
      features.ombre_mcp_configured === true
        ? "请到“记忆”页面查看真实握手结果和服务器工具目录。"
        : "以后只需在后端填写 OMBRE_BRAIN_URL；令牌只保存在 Render，不会进入手机或网页。",
      "",
      "",
    ),
  ];
}

export function describeGroqExpiry(value, now = new Date()) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return {
      status: "unknown",
      text: "尚未记录到期日；请按照 Groq 创建密钥时选择的日期填写。",
    };
  }

  const expiresAt = new Date(`${normalized}T23:59:59Z`);
  if (Number.isNaN(expiresAt.getTime())) {
    return { status: "unknown", text: "到期日期格式不正确。" };
  }

  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) {
    return { status: "expired", text: "该日期已经过去，请立即轮换 Groq 密钥。" };
  }
  if (days <= 14) {
    return {
      status: "warning",
      text: `距离到期约 ${days} 天，请提前创建并更换密钥。`,
    };
  }
  return { status: "ok", text: `距离到期约 ${days} 天。` };
}

export function readGroqExpiryDate(
  storage = globalThis.localStorage,
  accountScope = "",
) {
  try {
    return (
      readAccountStorage(storage, GROQ_EXPIRY_STORAGE_KEY, accountScope, {
        migrateLegacy: true,
      }) || ""
    );
  } catch {
    return "";
  }
}

export function storeGroqExpiryDate(
  value,
  storage = globalThis.localStorage,
  accountScope = "",
) {
  try {
    const normalized = String(value || "").trim();
    writeAccountStorage(
      storage,
      GROQ_EXPIRY_STORAGE_KEY,
      accountScope,
      normalized || null,
    );
  } catch {
    // 本地提醒写入失败不应影响聊天和服务器设置。
  }
}
import { readAccountStorage, writeAccountStorage } from "./account-storage.js";
