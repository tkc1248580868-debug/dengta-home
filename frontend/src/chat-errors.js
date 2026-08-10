const CHAT_ERROR_FALLBACK = "模型服务暂时无法完成这次回复，请稍后重试。";
const COMMITTED_CHAT_ERROR_FALLBACK =
  "AI 回复没有完成，但你的消息已经保存，可以稍后重试。";
const MAX_PUBLIC_ERROR_LENGTH = 220;
const DEFAULT_MAX_PROVIDER_PROBE_LENGTH = 4096;
const HTML_DOCUMENT_SIGNATURES = ["<!doctype html", "<html", "<head", "<body"];
const ERROR_ENVELOPE_KEYS = new Set([
  "code",
  "detail",
  "details",
  "error",
  "errors",
  "message",
  "param",
  "request_id",
  "requestid",
  "status",
  "status_code",
  "statuscode",
  "type",
]);
const ERROR_DETAIL_KEYS = new Set([
  "code",
  "detail",
  "details",
  "message",
  "param",
  "status",
  "status_code",
  "statuscode",
  "type",
]);
const ERROR_CODE_PATTERN =
  /(?:error|denied|forbidden|unauth|invalid|policy|rate|limit|fail|timeout|quota|^4\d\d$|^5\d\d$)/i;

const PUBLIC_ERROR_BY_CODE = Object.freeze({
  CHAT_GENERATION_IN_PROGRESS: "这条消息已经保存，AI 仍在服务器处理中。",
});

const MARKUP_OR_DOCUMENT_PATTERN =
  /<!doctype|<\/?(?:html|head|body|script|style|pre|code|div|span|table|iframe|svg)\b|&lt;\/?(?:html|body|pre|code)\b/i;
const STACK_OR_CODE_PATTERN =
  /(?:^|\s)(?:traceback|syntaxerror|typeerror|referenceerror|stack(?:trace)?\s*[:=]|at\s+[\w$.<>]+\s*\([^\n]*:\d+:\d+\)|node_modules[\\/]|webpack:\/\/|```|econnrefused|enotfound|fetch failed|sqlstate|permission denied|relation\s+.+\s+does not exist)/i;
const SECRET_PATTERN =
  /(?:authorization\s*[:=]|bearer\s+[a-z0-9._-]{12,}|api[_ -]?key\s*[:=]|cookie\s*[:=]|sk-[a-z0-9_-]{12,}|sb_secret_[a-z0-9_-]+)/i;

function errorCandidate(source) {
  if (typeof source === "string") return source;
  return source?.content || source?.message || source?.detail || "";
}

function stripControlCharacters(value) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || [9, 10, 13].includes(code);
    })
    .join("");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedKeys(value) {
  return Object.keys(value || {}).map((key) => key.toLowerCase());
}

function keysBelongTo(value, allowed) {
  const keys = normalizedKeys(value);
  return keys.length > 0 && keys.every((key) => allowed.has(key));
}

function statusLooksLikeError(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric >= 400;
  return ERROR_CODE_PATTERN.test(String(value || ""));
}

function isProviderErrorEnvelope(value) {
  if (!isPlainObject(value) || !keysBelongTo(value, ERROR_ENVELOPE_KEYS)) {
    return false;
  }

  if (Object.hasOwn(value, "error")) {
    if (typeof value.error === "string") return value.error.trim().length > 0;
    if (
      isPlainObject(value.error) &&
      keysBelongTo(value.error, ERROR_DETAIL_KEYS) &&
      normalizedKeys(value.error).some((key) =>
        ["code", "detail", "details", "message", "status", "type"].includes(
          key,
        ),
      )
    ) {
      return true;
    }
  }

  const status = value.status ?? value.status_code ?? value.statusCode;
  if (statusLooksLikeError(status) && (value.message || value.detail)) {
    return true;
  }
  return Boolean(value.message) && ERROR_CODE_PATTERN.test(String(value.code || ""));
}

function htmlDocumentVerdict(text, final) {
  const lower = text.toLowerCase();
  for (const signature of HTML_DOCUMENT_SIGNATURES) {
    if (lower.length < signature.length && signature.startsWith(lower)) {
      return final ? "safe" : "pending";
    }
    if (!lower.startsWith(signature)) continue;

    const boundary = lower[signature.length];
    if (signature === "<!doctype html") {
      return boundary === undefined && !final ? "pending" : "blocked";
    }
    if (boundary === undefined) return final ? "blocked" : "pending";
    return /[\s>]/.test(boundary) ? "blocked" : "safe";
  }
  return "safe";
}

function providerTextVerdict(
  value,
  { final = false, maxProbeLength = DEFAULT_MAX_PROVIDER_PROBE_LENGTH } = {},
) {
  const source = String(value || "").replace(/^\uFEFF/, "");
  const text = source.trimStart();
  if (!text) return final || source.length >= 64 ? "safe" : "pending";

  if (text.startsWith("<")) return htmlDocumentVerdict(text, final);
  if (!text.startsWith("{")) return "safe";
  if (text.length > maxProbeLength) return "safe";

  try {
    return isProviderErrorEnvelope(JSON.parse(text)) ? "blocked" : "safe";
  } catch {
    return final ? "safe" : "pending";
  }
}

export function isProviderErrorDocument(value) {
  return providerTextVerdict(value, { final: true }) === "blocked";
}

export function createProviderTextGuard(options = {}) {
  let state = "pending";
  let buffer = "";

  function result(content = "") {
    return {
      content,
      blocked: state === "blocked",
      pending: state === "pending",
    };
  }

  function settle(final) {
    const verdict = providerTextVerdict(buffer, { ...options, final });
    if (verdict === "pending") return result();
    state = verdict;
    if (state === "blocked") {
      buffer = "";
      return result();
    }
    const content = buffer;
    buffer = "";
    return result(content);
  }

  return {
    push(value) {
      const content = String(value || "");
      if (!content || state === "blocked") return result();
      if (state === "safe") return result(content);
      buffer += content;
      return settle(false);
    },
    finish() {
      if (state !== "pending") return result();
      return settle(true);
    },
    get blocked() {
      return state === "blocked";
    },
  };
}

export function sanitizeStoredChatMessage(message = {}) {
  if (
    message?.role !== "assistant" ||
    !isProviderErrorDocument(message?.content)
  ) {
    return message;
  }
  return {
    ...message,
    content: COMMITTED_CHAT_ERROR_FALLBACK,
    chatError: true,
    generationInProgress: false,
    isStreaming: false,
    retryAvailable: true,
  };
}

export function publicChatErrorMessage(source, fallback = CHAT_ERROR_FALLBACK) {
  const code = String(source?.code || "");
  const safeFallback = PUBLIC_ERROR_BY_CODE[code] || fallback;

  const candidate = stripControlCharacters(errorCandidate(source))
    .replace(/\s+/g, " ")
    .trim();
  if (!candidate) return safeFallback;
  if (candidate.length > MAX_PUBLIC_ERROR_LENGTH) return safeFallback;
  if (/^[{[]/.test(candidate) && /[}\]]$/.test(candidate)) return safeFallback;
  if (
    MARKUP_OR_DOCUMENT_PATTERN.test(candidate) ||
    STACK_OR_CODE_PATTERN.test(candidate) ||
    SECRET_PATTERN.test(candidate)
  ) {
    return safeFallback;
  }
  return candidate;
}

export function sanitizeChatErrorEvent(event = {}) {
  const fallback =
    event.user_message_committed === true
      ? COMMITTED_CHAT_ERROR_FALLBACK
      : CHAT_ERROR_FALLBACK;
  return {
    ...event,
    content: publicChatErrorMessage(event, fallback),
  };
}

export function dismissChatErrorMessage(messages, messageId) {
  return (Array.isArray(messages) ? messages : []).filter(
    (item) => !(item?.id === messageId && item?.chatError === true),
  );
}

export {
  CHAT_ERROR_FALLBACK,
  COMMITTED_CHAT_ERROR_FALLBACK,
  MAX_PUBLIC_ERROR_LENGTH,
};
