import { isChatGenerationInProgress } from "./chat-idempotency.js";
import { authSession as defaultAuthSession } from "./auth-session.js";
import {
  COMMITTED_CHAT_ERROR_FALLBACK,
  createProviderTextGuard,
  isProviderErrorDocument,
  publicChatErrorMessage,
  sanitizeChatErrorEvent,
} from "./chat-errors.js";

const API_BASE_URL = (
  import.meta.env?.VITE_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

const RETRYABLE_SERVER_STATUSES = new Set([502, 503, 504]);

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function awaitWithAbortSignal(value, signal) {
  if (!signal) return Promise.resolve(value);
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ||
        new DOMException("The operation was aborted.", "AbortError"),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      callback(result);
    };
    const handleAbort = () => {
      finish(
        reject,
        signal.reason ||
          new DOMException("The operation was aborted.", "AbortError"),
      );
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    Promise.resolve(value).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

async function fetchFromApi(path, options = {}) {
  const {
    timeoutMs = 0,
    retry = true,
    authSession = defaultAuthSession,
    ...requestOptions
  } = options;
  const method = String(requestOptions.method || "GET").toUpperCase();
  const retryDelays = retry && method === "GET" ? [0, 1500, 4000] : [0];

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt];
    if (delay > 0) await wait(delay);

    let timeoutId;
    let timedOut = false;
    const controller =
      timeoutMs > 0 && !requestOptions.signal ? new AbortController() : null;

    try {
      if (controller) {
        timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
      const authContext = await awaitWithAbortSignal(
        authSession?.getRequestContext?.(),
        controller?.signal,
      );
      const headers = new Headers(requestOptions.headers || {});
      if (authContext?.accessToken) {
        headers.set("Authorization", `Bearer ${authContext.accessToken}`);
      }
      if (authContext?.companionId) {
        headers.set("X-DengTa-Companion-Id", authContext.companionId);
      }
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...requestOptions,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      authSession?.captureCompanionFromResponse?.(response);
      if (
        attempt < retryDelays.length - 1 &&
        RETRYABLE_SERVER_STATUSES.has(response.status)
      ) {
        continue;
      }
      return response;
    } catch (error) {
      if (requestOptions.signal?.aborted) {
        throw error;
      }
      if (timedOut) {
        const timeoutError = new Error(
          `等待 DengTa 后端响应超过 ${Math.ceil(timeoutMs / 1000)} 秒，本次不会自动重复请求。`,
          { cause: error },
        );
        timeoutError.code = "request_timeout";
        throw timeoutError;
      }
      if (attempt === retryDelays.length - 1) break;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw new Error("无法连接 DengTa 服务器，请检查手机网络后重试。");
}

export async function apiFetch(path, options = {}) {
  const response = await fetchFromApi(path, options);
  if (
    response.status === 401 &&
    typeof response.clone === "function"
  ) {
    const data = await response.clone().json().catch(() => ({}));
    if (
      ["invalid_session", "authentication_required"].includes(data.code)
    ) {
      await (options.authSession || defaultAuthSession)
        ?.invalidateSession?.(data.message);
    }
  }
  return response;
}

export async function apiRequest(path, options = {}) {
  const response = await apiFetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (
      response.status === 401 &&
      ["invalid_session", "authentication_required"].includes(data.code)
    ) {
      await (options.authSession || defaultAuthSession)
        ?.invalidateSession?.(data.message);
    }
    const error = new Error(
      publicChatErrorMessage(data, "请求失败，请稍后重试。"),
    );
    error.status = response.status;
    error.code = data.code || "api_request_failed";
    throw error;
  }

  return data;
}

export function buildStreamChatFormData(
  payload = {},
  FormDataImpl = globalThis.FormData,
) {
  if (!FormDataImpl) {
    throw new Error("当前环境不能发送聊天附件。");
  }

  const formData = new FormDataImpl();
  const fields = {
    message: payload.message,
    session_id: payload.session_id,
    client_time: payload.client_time,
    timezone: payload.timezone,
    emotion_understanding_enabled:
      payload.emotion_understanding_enabled === true ? "true" : "false",
    attachment_instruction_mode:
      payload.attachment_instruction_mode === "system" ? "system" : "untrusted",
    attachment_storage_mode:
      payload.attachment_storage_mode === "ephemeral"
        ? "ephemeral"
        : "persistent",
    companion_status:
      typeof payload.companion_status === "string"
        ? payload.companion_status
        : JSON.stringify(payload.companion_status || {}),
    environment_context:
      typeof payload.environment_context === "string"
        ? payload.environment_context
        : JSON.stringify(payload.environment_context || {}),
    turn_context: payload.turn_context,
    model: payload.model,
    client_message_id: payload.client_message_id,
  };
  if (
    payload.message_reference !== undefined &&
    payload.message_reference !== null &&
    payload.message_reference !== ""
  ) {
    fields.message_reference =
      typeof payload.message_reference === "string"
        ? payload.message_reference
        : JSON.stringify(payload.message_reference);
  }

  Object.entries(fields).forEach(([name, value]) => {
    formData.append(name, String(value ?? ""));
  });

  Array.from(payload.files || []).forEach((item) => {
    const file = item?.file || item;
    if (!(file instanceof Blob) || file.size === 0) return;
    formData.append("files", file, file.name || item?.name || "附件");
  });

  return formData;
}

export async function streamChat(
  payload,
  onEvent,
  { signal, authSession = defaultAuthSession } = {},
) {
  const formData = buildStreamChatFormData(payload);
  const response = await apiFetch("/chat/stream", {
    method: "POST",
    body: formData,
    signal,
    authSession,
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    const data = await response.json().catch(() => ({}));
    if (
      response.status === 401 &&
      ["invalid_session", "authentication_required"].includes(data.code)
    ) {
      await authSession?.invalidateSession?.(data.message);
    }
    const error = new Error(
      publicChatErrorMessage(data, "无法开始流式回复。"),
    );
    error.status = response.status;
    error.code = data.code || "stream_request_failed";
    throw error;
  }

  if (!response.body) {
    throw new Error("当前浏览器无法读取流式回复。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError = null;
  let completionEvent = null;
  let userMessageCommitted = false;
  const providerTextGuard = createProviderTextGuard();

  function createStreamError(source) {
    const message = publicChatErrorMessage(
      source,
      userMessageCommitted
        ? COMMITTED_CHAT_ERROR_FALLBACK
        : "回复中断，请稍后重试。",
    );
    const error = new Error(message);
    error.userMessageCommitted = userMessageCommitted;
    if (source?.code) error.code = source.code;
    error.generationInProgress = isChatGenerationInProgress(source);
    return error;
  }

  function emitProviderDocumentError() {
    if (streamError?.code === "provider_error_document") return;
    streamError = sanitizeChatErrorEvent({
      type: "error",
      code: "provider_error_document",
      content: "",
      user_message_committed: userMessageCommitted,
    });
    onEvent(streamError);
  }

  function emitScreenedProviderText(event) {
    const screened = providerTextGuard.push(event.content);
    if (screened.blocked) {
      emitProviderDocumentError();
      return;
    }
    if (screened.content) onEvent({ ...event, content: screened.content });
  }

  function finishProviderText() {
    const screened = providerTextGuard.finish();
    if (screened.blocked) {
      emitProviderDocumentError();
      return false;
    }
    if (screened.content) {
      onEvent({ type: "text", content: screened.content });
    }
    return true;
  }

  function processLine(rawLine) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("data:")) return;
    const json = line.slice(5).trim();
    if (!json) return;

    try {
      const event = JSON.parse(json);
      if (
        (event.type === "meta" && event.user_message) ||
        event.user_message_committed === true
      ) {
        userMessageCommitted = true;
      }
      if (event.type === "text") {
        emitScreenedProviderText(event);
        return;
      }
      if (event.type === "error") {
        streamError = sanitizeChatErrorEvent(event);
        onEvent(streamError);
        return;
      }
      if (event.type === "done") {
        if (
          isProviderErrorDocument(event.assistant_message?.content || event.reply)
        ) {
          emitProviderDocumentError();
          return;
        }
        if (!finishProviderText()) return;
        completionEvent = event;
        if (event.ok === false) {
          streamError = streamError || event;
        }
      }
      onEvent(event);
    } catch {
      // 半截数据会留在 buffer 中；真正损坏的单条事件忽略即可。
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(processLine);
    }

    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);

    if (!completionEvent && !streamError) finishProviderText();

    if (streamError) {
      throw createStreamError(streamError);
    }

    if (!completionEvent) {
      throw createStreamError(
        {
          message: userMessageCommitted
            ? "回复连接提前结束，但你的消息已经保存。"
            : "回复连接提前结束，服务器没有确认本轮已保存。附件仍保留，可稍后重试。",
        },
      );
    }

    return completionEvent;
  } finally {
    if (signal?.aborted) {
      await reader.cancel(signal.reason).catch(() => {});
    }
    reader.releaseLock();
  }
}

export { API_BASE_URL };
