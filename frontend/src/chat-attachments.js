export const CHAT_ATTACHMENT_MAX_FILES = 4;
export const CHAT_ATTACHMENT_MAX_FILE_BYTES = 12 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/json",
  "application/xml",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/xml",
]);

const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "docx",
  "json",
  "md",
  "pdf",
  "txt",
  "xml",
]);

const IMAGE_EXTENSION_TYPES = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
]);

const AUDIO_EXTENSION_TYPES = new Map([
  ["webm", "audio/webm"],
  ["ogg", "audio/ogg"],
  ["m4a", "audio/mp4"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["3gp", "audio/3gpp"],
  ["amr", "audio/amr"],
]);

const AUDIO_EXTENSION_ALLOWED_TYPES = new Map([
  ["webm", new Set(["audio/webm"])],
  ["ogg", new Set(["audio/ogg"])],
  ["m4a", new Set(["audio/mp4", "audio/x-m4a"])],
  ["mp3", new Set(["audio/mpeg"])],
  ["wav", new Set(["audio/wav", "audio/x-wav"])],
  ["aac", new Set(["audio/aac"])],
  ["flac", new Set(["audio/flac"])],
  ["3gp", new Set(["audio/3gpp"])],
  ["amr", new Set(["audio/amr"])],
]);

const VIDEO_EXTENSION_TYPES = new Map([
  ["mp4", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
]);

const VIDEO_EXTENSION_ALLOWED_TYPES = new Map([
  ["mp4", new Set(["video/mp4"])],
  ["mov", new Set(["video/quicktime"])],
  ["webm", new Set(["video/webm"])],
]);

const DOCUMENT_EXTENSION_TYPES = new Map([
  ["pdf", "application/pdf"],
  [
    "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["csv", "text/csv"],
  ["json", "application/json"],
  ["xml", "application/xml"],
]);

const DOCUMENT_EXTENSION_ALLOWED_TYPES = new Map([
  ["pdf", new Set(["application/pdf"])],
  [
    "docx",
    new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
  ],
  ["txt", new Set(["text/plain"])],
  ["md", new Set(["text/markdown", "text/plain"])],
  ["csv", new Set(["text/csv", "application/csv", "text/plain"])],
  ["json", new Set(["application/json", "text/json", "text/plain"])],
  ["xml", new Set(["application/xml", "text/xml", "text/plain"])],
]);

function cleanText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function extensionOf(name) {
  const matched = cleanText(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return matched?.[1] || "";
}

export function normalizedAttachmentMimeType(fileLike = {}) {
  const reported = cleanText(
    fileLike.type || fileLike.mime_type || fileLike.content_type,
  ).toLowerCase();
  if (reported && reported !== "application/octet-stream") return reported;

  const extension = extensionOf(fileLike.name || fileLike.file_name);
  return (
    IMAGE_EXTENSION_TYPES.get(extension) ||
    VIDEO_EXTENSION_TYPES.get(extension) ||
    AUDIO_EXTENSION_TYPES.get(extension) ||
    DOCUMENT_EXTENSION_TYPES.get(extension) ||
    reported
  );
}

export function normalizeAttachmentFile(file, FileConstructor = globalThis.File) {
  const normalizedType = normalizedAttachmentMimeType(file);
  if (
    !file ||
    !normalizedType ||
    file.type === normalizedType ||
    typeof FileConstructor !== "function"
  ) {
    return file;
  }

  return new FileConstructor([file], file.name, {
    type: normalizedType,
    lastModified: file.lastModified || Date.now(),
  });
}

export function attachmentKind(fileLike = {}) {
  const type = normalizedAttachmentMimeType(fileLike);
  const extension = extensionOf(fileLike.name || fileLike.file_name);
  if (type.startsWith("image/")) {
    return IMAGE_EXTENSION_TYPES.get(extension) === type
      ? "image"
      : "unsupported";
  }
  if (type.startsWith("audio/")) {
    return AUDIO_EXTENSION_ALLOWED_TYPES.get(extension)?.has(type)
      ? "audio"
      : "unsupported";
  }
  if (type.startsWith("video/")) {
    return VIDEO_EXTENSION_ALLOWED_TYPES.get(extension)?.has(type)
      ? "video"
      : "unsupported";
  }
  if (
    DOCUMENT_MIME_TYPES.has(type) &&
    DOCUMENT_EXTENSIONS.has(extension) &&
    DOCUMENT_EXTENSION_ALLOWED_TYPES.get(extension)?.has(type)
  ) {
    return "document";
  }
  return "unsupported";
}

export function formatAttachmentSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "大小未知";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function validateAttachmentFiles(existing = [], incoming = []) {
  const current = Array.isArray(existing) ? existing : [];
  const selected = Array.from(incoming || []);
  const accepted = [];
  const rejected = [];
  let totalBytes = current.reduce(
    (sum, item) => sum + Math.max(0, Number(item?.size || item?.file?.size || 0)),
    0,
  );

  for (const file of selected) {
    if (current.length + accepted.length >= CHAT_ATTACHMENT_MAX_FILES) {
      rejected.push(`${cleanText(file?.name) || "未命名文件"}：一条消息最多添加 4 个附件`);
      continue;
    }

    if (attachmentKind(file) === "unsupported") {
      rejected.push(
        `${cleanText(file?.name) || "未命名文件"}：暂不支持这种文件，只能选择图片、视频、文档或音频`,
      );
      continue;
    }

    const size = Math.max(0, Number(file?.size || 0));
    if (size === 0) {
      rejected.push(`${cleanText(file?.name) || "未命名文件"}：文件为空`);
      continue;
    }

    if (size > CHAT_ATTACHMENT_MAX_FILE_BYTES) {
      rejected.push(
        `${cleanText(file?.name) || "未命名文件"}：单个附件不能超过 12MB`,
      );
      continue;
    }

    if (totalBytes + size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
      rejected.push(
        `${cleanText(file?.name) || "未命名文件"}：全部附件合计不能超过 20MB`,
      );
      continue;
    }

    accepted.push(file);
    totalBytes += size;
  }

  return { accepted, rejected, totalBytes };
}

export function createAttachmentDraft(file, urlApi = globalThis.URL) {
  const kind = attachmentKind(file);
  const previewUrl =
    (kind === "image" || kind === "audio" || kind === "video") &&
    typeof urlApi?.createObjectURL === "function"
      ? urlApi.createObjectURL(file)
      : "";

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    name: cleanText(file?.name) || "未命名文件",
    type: normalizedAttachmentMimeType(file) || "application/octet-stream",
    size: Math.max(0, Number(file?.size || 0)),
    kind,
    previewUrl,
  };
}

export function revokeAttachmentDraft(draft, urlApi = globalThis.URL) {
  if (draft?.previewUrl && typeof urlApi?.revokeObjectURL === "function") {
    urlApi.revokeObjectURL(draft.previewUrl);
  }
}

export function shouldRestoreAttachmentDrafts({
  requestWasAborted = false,
  cancelReason = "",
} = {}) {
  if (!requestWasAborted) return true;
  return cancelReason === "view-change";
}

export function restoreAttachmentDrafts(sent = [], current = [], limit = 4) {
  const restored = [];
  const seen = new Set();
  for (const draft of [...sent, ...current]) {
    const identity = draft?.id || draft;
    if (!draft || seen.has(identity)) continue;
    seen.add(identity);
    restored.push(draft);
    if (restored.length >= limit) break;
  }
  return restored;
}

function safeAttachmentUrl(rawValue, kind, apiBaseUrl = "") {
  const value = cleanText(rawValue, 8_000);
  if (!value) return "";

  if (kind === "image" && /^data:image\/(?:avif|gif|jpeg|jpg|png|webp);base64,/i.test(value)) {
    return value;
  }
  if (/^blob:/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/") && /^https?:\/\//i.test(apiBaseUrl)) {
    return `${apiBaseUrl.replace(/\/$/, "")}${value}`;
  }
  return "";
}

export function normalizeMessageAttachments(value, apiBaseUrl = "") {
  if (!Array.isArray(value)) return [];

  return value.slice(0, CHAT_ATTACHMENT_MAX_FILES).map((item, index) => {
    const source = item && typeof item === "object" ? item : {};
    const name =
      cleanText(source.name || source.file_name || source.filename) ||
      `附件 ${index + 1}`;
    const type =
      normalizedAttachmentMimeType({
        name,
        type: source.type || source.mime_type || source.content_type,
      }) || "application/octet-stream";
    const kind = attachmentKind({ name, type });
    const rawUrl =
      source.previewUrl ||
      source.preview_url ||
      source.download_url ||
      source.url ||
      source.path;

    return {
      id: cleanText(source.id) || `${name}-${index}`,
      name,
      type,
      size: Math.max(0, Number(source.size || source.file_size || 0)),
      kind: kind === "unsupported" ? "document" : kind,
      url: safeAttachmentUrl(rawUrl, kind, apiBaseUrl),
    };
  });
}

export function draftsForLocalMessage(drafts = []) {
  return drafts.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    size: item.size,
    previewUrl: item.previewUrl,
  }));
}
