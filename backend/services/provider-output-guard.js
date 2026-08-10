const DEFAULT_MAX_PROBE_LENGTH = 4096;
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
    "type"
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
    "type"
]);
const ERROR_CODE_PATTERN =
    /(?:error|denied|forbidden|unauth|invalid|policy|rate|limit|fail|timeout|quota|^4\d\d$|^5\d\d$)/i;

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
                    key
                )
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

function providerOutputVerdict(
    value,
    { final = false, maxProbeLength = DEFAULT_MAX_PROBE_LENGTH } = {}
) {
    const source = String(value || "").replace(/^\uFEFF/, "");
    const text = source.trimStart();
    if (!text) {
        return final || source.length >= 64 ? "safe" : "pending";
    }

    if (text.startsWith("<")) {
        return htmlDocumentVerdict(text, final);
    }

    if (!text.startsWith("{")) return "safe";
    if (text.length > maxProbeLength) return "safe";

    try {
        return isProviderErrorEnvelope(JSON.parse(text)) ? "blocked" : "safe";
    } catch {
        return final ? "safe" : "pending";
    }
}

function isProviderErrorDocument(value) {
    return providerOutputVerdict(value, { final: true }) === "blocked";
}

function createProviderOutputGuard(options = {}) {
    let state = "pending";
    let buffer = "";

    function result(content = "") {
        return { content, blocked: state === "blocked", pending: state === "pending" };
    }

    function settle(final) {
        const verdict = providerOutputVerdict(buffer, { ...options, final });
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
        }
    };
}

function providerErrorDocumentError() {
    const error = new Error("模型服务返回了异常错误文档，请稍后重试。");
    error.code = "provider_error_document";
    error.status = 502;
    return error;
}

function assertProviderOutputSafe(value) {
    if (isProviderErrorDocument(value)) throw providerErrorDocumentError();
    return value;
}

module.exports = {
    assertProviderOutputSafe,
    createProviderOutputGuard,
    isProviderErrorDocument,
    isProviderErrorEnvelope,
    providerErrorDocumentError,
    providerOutputVerdict
};
