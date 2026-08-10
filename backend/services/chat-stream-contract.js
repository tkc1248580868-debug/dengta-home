function streamSuccess(result) {
    return { ...result, type: "done", ok: true };
}

const PUBLIC_CHAT_ERROR_CODES = new Set(["CHAT_GENERATION_IN_PROGRESS"]);
const PUBLIC_CHAT_ERROR_MESSAGES = Object.freeze({
    CHAT_GENERATION_IN_PROGRESS: "这条消息已经保存，AI 仍在服务器处理中。"
});
const CHAT_ERROR_FALLBACK = "模型服务暂时无法完成这次回复，请稍后重试。";
const COMMITTED_CHAT_ERROR_FALLBACK =
    "AI 回复没有完成，但你的消息已经保存，可以稍后重试。";
const MAX_PUBLIC_ERROR_LENGTH = 220;
const MARKUP_OR_DOCUMENT_PATTERN =
    /<!doctype|<\/?(?:html|head|body|script|style|pre|code|div|span|table|iframe|svg)\b|&lt;\/?(?:html|body|pre|code)\b/i;
const STACK_OR_CODE_PATTERN =
    /(?:^|\s)(?:traceback|syntaxerror|typeerror|referenceerror|stack(?:trace)?\s*[:=]|at\s+[\w$.<>]+\s*\([^\n]*:\d+:\d+\)|node_modules[\\/]|webpack:\/\/|```|econnrefused|enotfound|fetch failed|sqlstate|permission denied|relation\s+.+\s+does not exist)/i;
const SECRET_PATTERN =
    /(?:authorization\s*[:=]|bearer\s+[a-z0-9._-]{12,}|api[_ -]?key\s*[:=]|cookie\s*[:=]|sk-[a-z0-9_-]{12,}|sb_secret_[a-z0-9_-]+)/i;

function publicChatErrorCode(error) {
    const code = String(error?.code || "");
    return PUBLIC_CHAT_ERROR_CODES.has(code) ? code : null;
}

function stripControlCharacters(value) {
    return Array.from(String(value || ""))
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code >= 32 || [9, 10, 13].includes(code);
        })
        .join("");
}

function publicChatErrorMessage(error, fallback = CHAT_ERROR_FALLBACK) {
    const code = String(error?.code || "");
    const safeFallback = PUBLIC_CHAT_ERROR_MESSAGES[code] || fallback;
    const candidate = stripControlCharacters(error?.message || error?.content)
        .replace(/\s+/g, " ")
        .trim();
    if (!candidate || candidate.length > MAX_PUBLIC_ERROR_LENGTH) return safeFallback;
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

function streamFailure(error, { userMessageCommitted = false } = {}) {
    const code = publicChatErrorCode(error);
    const fallback = userMessageCommitted
        ? COMMITTED_CHAT_ERROR_FALLBACK
        : CHAT_ERROR_FALLBACK;
    return {
        type: "error",
        ok: false,
        content: publicChatErrorMessage(error, fallback),
        user_message_committed: userMessageCommitted === true,
        ...(code ? { code } : {})
    };
}

module.exports = {
    publicChatErrorCode,
    publicChatErrorMessage,
    streamFailure,
    streamSuccess
};
