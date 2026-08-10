const { filterThinkTags } = require("./think-tag-filter");

const MAX_REASONING_CHUNK_CHARS = 800;
const MAX_REASONING_TOTAL_CHARS = 6000;
const MAX_PENDING_PROVIDER_CHARS = 24000;
const PROVIDER_SUMMARY_BOUNDARY_PATTERN = /[\n。！？.!?]/g;
const REDACTED_REASONING_TEXT = "[已隐藏敏感推理片段]";
const PUBLIC_REASONING_SOURCES = new Set(["provider_summary"]);

function characterSlice(value, maximum) {
    return Array.from(String(value || ""))
        .slice(0, maximum)
        .join("");
}

function redactCredentialLikeText(value) {
    return String(value || "")
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[已隐藏密钥]")
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [已隐藏密钥]")
        .replace(
            /(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b(\s*[:=]\s*)[^\s,;]+/gi,
            "$1$2[已隐藏密钥]"
        )
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[已隐藏私钥]");
}

function normalizeSensitiveLines(values) {
    const source = Array.isArray(values) ? values : [values];
    const lines = new Set();

    for (const value of source) {
        if (typeof value !== "string") continue;
        for (const line of value.split(/\r?\n/)) {
            const normalized = line.trim();
            if (Array.from(normalized).length >= 8) {
                lines.add(characterSlice(normalized, 1200));
            }
        }
    }

    return [...lines]
        .sort((left, right) => right.length - left.length);
}

function redactSensitiveEcho(value, sensitiveLines) {
    let text = String(value || "");
    const trimmed = text.trim();

    if (
        Array.from(trimmed).length >= 8 &&
        sensitiveLines.some((line) => line.includes(trimmed))
    ) {
        return REDACTED_REASONING_TEXT;
    }

    for (const line of sensitiveLines) {
        if (text.includes(line)) {
            text = text.split(line).join(REDACTED_REASONING_TEXT);
        }
    }
    return text;
}

function sanitizeReasoningFragment(value, sensitiveTexts = []) {
    if (typeof value !== "string") return "";

    const withoutControls = value.replace(
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
        " "
    );
    const withoutThinkTags = filterThinkTags(withoutControls);
    const sensitiveLines = normalizeSensitiveLines(sensitiveTexts);
    return redactSensitiveEcho(
        redactCredentialLikeText(withoutThinkTags),
        sensitiveLines
    ).trim();
}

function normalizePublicReasoningSource(value) {
    const source = String(value || "").trim().toLowerCase();
    if (!source) return "provider_summary";
    return PUBLIC_REASONING_SOURCES.has(source) ? source : "";
}

function createReasoningEventEmitter({
    onEvent,
    sensitiveTexts = [],
    chunkLimit = MAX_REASONING_CHUNK_CHARS,
    totalLimit = MAX_REASONING_TOTAL_CHARS
} = {}) {
    const emitEvent = typeof onEvent === "function" ? onEvent : () => {};
    const requestedChunkLimit = Number(chunkLimit);
    const requestedTotalLimit = Number(totalLimit);
    const safeChunkLimit = Math.max(
        1,
        Math.min(
            MAX_REASONING_CHUNK_CHARS,
            Number.isFinite(requestedChunkLimit)
                ? Math.round(requestedChunkLimit)
                : MAX_REASONING_CHUNK_CHARS
        )
    );
    const safeTotalLimit = Math.max(
        safeChunkLimit,
        Math.min(
            MAX_REASONING_TOTAL_CHARS,
            Number.isFinite(requestedTotalLimit)
                ? Math.round(requestedTotalLimit)
                : MAX_REASONING_TOTAL_CHARS
        )
    );
    const accumulatedSensitiveTexts = Array.isArray(sensitiveTexts)
        ? [...sensitiveTexts]
        : [sensitiveTexts];
    let emittedCharacters = 0;
    let pendingProviderText = "";

    function addSensitiveText(value) {
        if (typeof value === "string" && value.trim()) {
            accumulatedSensitiveTexts.push(value);
        }
    }

    function emitSanitized(value, source) {
        if (emittedCharacters >= safeTotalLimit) return "";
        const sanitized = sanitizeReasoningFragment(
            value,
            accumulatedSensitiveTexts
        );
        if (!sanitized) return "";

        let remainingText = sanitized;
        let emittedText = "";
        while (remainingText && emittedCharacters < safeTotalLimit) {
            const remainingBudget = safeTotalLimit - emittedCharacters;
            const content = characterSlice(
                remainingText,
                Math.min(safeChunkLimit, remainingBudget)
            );
            if (!content) break;

            emittedCharacters += Array.from(content).length;
            emittedText += content;
            emitEvent({
                type: "reasoning",
                content,
                source,
                public: true
            });
            remainingText = Array.from(remainingText)
                .slice(Array.from(content).length)
                .join("");
        }
        return emittedText;
    }

    function flushCompleteProviderSentences() {
        if (!pendingProviderText) return "";

        let boundaryIndex = -1;
        for (const match of pendingProviderText.matchAll(
            PROVIDER_SUMMARY_BOUNDARY_PATTERN
        )) {
            boundaryIndex = match.index + match[0].length;
        }
        if (boundaryIndex <= 0) return "";

        const completeText = pendingProviderText.slice(0, boundaryIndex);
        pendingProviderText = pendingProviderText.slice(boundaryIndex);
        return emitSanitized(completeText, "provider_summary");
    }

    function flushProvider() {
        if (!pendingProviderText) return "";
        const value = pendingProviderText;
        pendingProviderText = "";
        return emitSanitized(value, "provider_summary");
    }

    function emit(value, options = {}) {
        const source = normalizePublicReasoningSource(options.source);
        if (source !== "provider_summary") {
            return emitSanitized(value, source);
        }

        pendingProviderText += String(value || "");
        if (
            Array.from(pendingProviderText).length >
            MAX_PENDING_PROVIDER_CHARS
        ) {
            pendingProviderText = REDACTED_REASONING_TEXT;
        }
        return flushCompleteProviderSentences();
    }

    return {
        addSensitiveText,
        emit,
        flushProvider,
        get emittedCharacters() {
            return emittedCharacters;
        }
    };
}

module.exports = {
    MAX_REASONING_CHUNK_CHARS,
    MAX_REASONING_TOTAL_CHARS,
    createReasoningEventEmitter,
    normalizePublicReasoningSource,
    sanitizeReasoningFragment
};
