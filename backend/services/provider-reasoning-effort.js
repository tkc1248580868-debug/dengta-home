const REASONING_EFFORTS = Object.freeze([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
]);
const REASONING_EFFORT_SET = new Set(REASONING_EFFORTS);

function reasoningProtocolForProvider(provider) {
    const normalized = String(provider || "")
        .trim()
        .toLowerCase();
    if (normalized === "openai-responses") return "openai-responses";
    if (["custom", "openai-compatible", "openai-chat"].includes(normalized)) {
        return "openai-chat";
    }
    return normalized;
}

function reasoningEffortError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function normalizeReasoningEffort(
    value,
    protocol,
    { strict = false } = {}
) {
    const effort = String(value || "").trim().toLowerCase();
    if (!effort) return "";

    if (!REASONING_EFFORT_SET.has(effort)) {
        if (strict) {
            throw reasoningEffortError(
                "推理强度必须是 none、low、medium、high、xhigh 或 max。",
                "AI_PROVIDER_REASONING_EFFORT_INVALID"
            );
        }
        return "";
    }

    if (protocol === "openai-responses") return effort;
    if (protocol === "openai-chat" && effort === "none") return effort;

    if (strict) {
        if (protocol === "openai-chat") {
            throw reasoningEffortError(
                "DengTa 的 Chat 兼容请求会保留函数工具，因此只能使用 none；需要高推理时请改用 OpenAI Responses 接口。",
                "AI_PROVIDER_REASONING_EFFORT_CHAT_TOOLS_UNSUPPORTED"
            );
        }
        throw reasoningEffortError(
            "当前接口协议不支持 OpenAI 推理强度参数。",
            "AI_PROVIDER_REASONING_EFFORT_PROTOCOL_UNSUPPORTED"
        );
    }

    return "";
}

function reasoningEffortField(protocol, effort) {
    if (!effort) return "";
    if (protocol === "openai-responses") return "reasoning.effort";
    if (protocol === "openai-chat") return "reasoning_effort";
    return "";
}

module.exports = {
    REASONING_EFFORTS,
    normalizeReasoningEffort,
    reasoningEffortField,
    reasoningProtocolForProvider
};
