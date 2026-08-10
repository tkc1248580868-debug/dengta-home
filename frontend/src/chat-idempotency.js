const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createChatClientMessageId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === "function") {
    return cryptoImpl.randomUUID();
  }
  if (typeof cryptoImpl?.getRandomValues !== "function") {
    throw new Error("当前设备无法创建安全的消息编号，请重新打开 App。");
  }

  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  );
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

export function chatRequestFingerprint({
  sessionId = "",
  message = "",
  turnContext = "",
  messageReference = null,
  attachments = [],
  attachmentInstructionMode = "untrusted",
  attachmentStorageMode = "persistent",
} = {}) {
  const files = Array.from(attachments || []).map((item) => {
    const file = item?.file || item || {};
    return [
      String(file.name || item?.name || ""),
      String(file.type || item?.type || ""),
      Math.max(0, Number(file.size || item?.size || 0)),
      Math.max(0, Number(file.lastModified || 0)),
    ];
  });
  return JSON.stringify([
    String(sessionId || ""),
    String(message || ""),
    String(turnContext || ""),
    JSON.stringify(messageReference || null),
    attachmentInstructionMode === "system" ? "system" : "untrusted",
    attachmentStorageMode === "ephemeral" ? "ephemeral" : "persistent",
    files,
  ]);
}

export function resolveChatClientMessage(
  pending,
  request,
  cryptoImpl = globalThis.crypto,
) {
  const fingerprint = chatRequestFingerprint(request);
  if (
    pending?.fingerprint === fingerprint &&
    UUID_PATTERN.test(String(pending.clientMessageId || ""))
  ) {
    return { ...pending, reused: true };
  }
  return {
    clientMessageId: createChatClientMessageId(cryptoImpl),
    fingerprint,
    reused: false,
  };
}

export function clearChatClientMessage(pending, clientMessageId) {
  return pending?.clientMessageId === clientMessageId ? null : pending;
}

export function updateChatClientMessage(pending, clientMessageId, changes = {}) {
  if (pending?.clientMessageId !== clientMessageId) return pending;
  return { ...pending, ...changes };
}

export function canRetryChatClientMessage(pending, request) {
  return Boolean(
    pending?.clientMessageId &&
      pending.fingerprint === chatRequestFingerprint(request),
  );
}

export function restoreChatRetryText(current, sentText) {
  return String(current || "") || String(sentText || "");
}

export function isChatGenerationInProgress(value) {
  const code = String(value?.code || "").trim().toUpperCase();
  if (code === "CHAT_GENERATION_IN_PROGRESS") return true;

  const message = String(value?.content || value?.message || value || "");
  return /(?:仍在|正在)处理中/.test(message);
}
