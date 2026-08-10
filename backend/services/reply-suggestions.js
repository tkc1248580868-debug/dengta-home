const REPLY_SUGGESTION_MAX_CHARS = 64;
const REPLY_SUGGESTION_SEGMENTER = new Intl.Segmenter("zh-CN", {
    granularity: "word"
});
const REPLY_SUGGESTION_CONTEXT_STOP_TOKENS = new Set([
    "我们",
    "你们",
    "他们",
    "她们",
    "这个",
    "那个",
    "这些",
    "那些",
    "可以",
    "愿意",
    "一起",
    "还是",
    "或者",
    "真的",
    "现在",
    "然后",
    "已经",
    "正在",
    "一点",
    "一下"
]);
const REPLY_SUGGESTION_CONTEXT_STOP_CHARACTERS = new Set(
    Array.from(
        "的一了是在我你您妳他她它们这那有和与及或就也都还很更再先好不没呢吧啊哦呀嘛么会能想要让给来去说请愿意可以已经正在"
    )
);
const REPLY_SUGGESTION_DIALOGUE_ACTION_PATTERNS = [
    /[?？]/u,
    /(?:还是|或者|\bor\b)/iu,
    /(?:请|告诉|回答|选择|决定|说说|聊聊|试试|想想|看看|听听)/u,
    /(?:你|您|妳).{0,16}(?:愿意|想要|要不要|能否|能不能|可以|会不会)/u,
    /(?:我|我们).{0,16}(?:想要|想让|希望|需要|想请).{0,16}(?:你|您|妳)/u
];

const SELECT_REPLY_SUGGESTIONS_TOOL = Object.freeze({
    name: "select_reply_suggestions",
    description: [
        "可选地为用户生成两条可点击的下一句回复候选。",
        "只有当前对话自然形成了明确的问题、邀请、情绪回应或剧情分岔，并且能从最近对话、当前氛围和用户表达方式中可靠推断两种合理说法时才调用。",
        "请先确定本轮即将给出的 AI 文字回复；候选必须能自然回应这段回复，是用户接下来可能对 AI 说的话，不是 AI 对用户说的话。",
        "两条应当表达真实不同但都自然的走向，不要机械套用同意与拒绝的固定结构。",
        "如果上下文不足、只是事实回答或过渡语、只能凑出牵强选项，请不要调用本工具。",
        "必须恰好提供两条简短完整的候选，不要在文字中添加 A、B 或选项编号。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            suggestions: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                uniqueItems: true,
                items: {
                    type: "string",
                    minLength: 1,
                    maxLength: REPLY_SUGGESTION_MAX_CHARS
                },
                description:
                    "恰好两条符合用户当前语气、可以直接发送给 AI 的下一句。"
            }
        },
        required: ["suggestions"],
        additionalProperties: false
    }
});

function removeControlCharacters(value) {
    return String(value ?? "").replace(
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu,
        " "
    );
}

function stripOptionPrefix(value) {
    return value.replace(
        /^(?:选项\s*)?(?:[abａｂ]|[12１２])(?:[\s.。、,，:：;；)）-]+|$)/iu,
        ""
    );
}

function cleanReplySuggestion(value) {
    if (typeof value !== "string") return "";
    const cleaned = stripOptionPrefix(
        removeControlCharacters(value).replace(/\s+/gu, " ").trim()
    ).trim();
    return Array.from(cleaned)
        .slice(0, REPLY_SUGGESTION_MAX_CHARS)
        .join("")
        .trim();
}

function suggestionComparisonKey(value) {
    return cleanReplySuggestion(value)
        .normalize("NFKC")
        .toLocaleLowerCase("zh-CN")
        .replace(/[\p{P}\p{Z}]/gu, "");
}

function normalizeReplySuggestions(value) {
    if (!Array.isArray(value) || value.length !== 2) return [];
    const suggestions = value.map(cleanReplySuggestion);
    if (suggestions.some((item) => !item)) return [];
    const comparisonKeys = suggestions.map(suggestionComparisonKey);
    if (
        comparisonKeys.some((item) => !item) ||
        comparisonKeys[0] === comparisonKeys[1]
    ) {
        return [];
    }
    return suggestions;
}

function replySuggestionPairComparisonKey(value) {
    const suggestions = normalizeReplySuggestions(value);
    if (suggestions.length !== 2) return "";
    return suggestions
        .map(suggestionComparisonKey)
        .sort()
        .join("\u0000");
}

function replySuggestionContextTokens(value) {
    const normalized = removeControlCharacters(value)
        .normalize("NFKC")
        .toLocaleLowerCase("zh-CN");
    const tokens = new Set(
        [...REPLY_SUGGESTION_SEGMENTER.segment(normalized)]
            .filter((item) => item.isWordLike)
            .map((item) => item.segment.trim())
            .filter(
                (item) =>
                    Array.from(item).length >= 2 &&
                    !REPLY_SUGGESTION_CONTEXT_STOP_TOKENS.has(item)
            )
    );
    for (const character of normalized.match(/\p{Script=Han}/gu) || []) {
        if (!REPLY_SUGGESTION_CONTEXT_STOP_CHARACTERS.has(character)) {
            tokens.add(character);
        }
    }
    return tokens;
}

function replySuggestionContextAnchorScore(suggestions, contextTokens) {
    const pairText = suggestions.map(suggestionComparisonKey).join("\n");
    const pairCharacters = Array.from(pairText);
    let score = 0;
    for (const token of replySuggestionContextTokens(pairText)) {
        if (!contextTokens.has(token)) continue;
        if (Array.from(token).length >= 2) {
            score += 2;
            continue;
        }
        score += Math.min(
            2,
            pairCharacters.filter((character) => character === token).length
        );
    }
    return score;
}

function hasReplySuggestionDialogueAction(value) {
    const text = removeControlCharacters(value).trim();
    return (
        text.length > 0 &&
        REPLY_SUGGESTION_DIALOGUE_ACTION_PATTERNS.some((pattern) =>
            pattern.test(text)
        )
    );
}

function finalizeReplySuggestions({
    recentMessages = [],
    assistantText = "",
    candidate = [],
    previousSuggestions = []
} = {}) {
    const latestUserMessage = [...recentMessages].reverse().find(
        (message) =>
            message?.role === "user" &&
            typeof message.content === "string" &&
            message.content.trim()
    );
    if (!latestUserMessage) return [];
    if (!hasReplySuggestionDialogueAction(assistantText)) return [];

    const suggestions = normalizeReplySuggestions(candidate);
    if (suggestions.length !== 2) return [];
    const previousPairKey =
        replySuggestionPairComparisonKey(previousSuggestions);
    if (
        previousPairKey &&
        previousPairKey === replySuggestionPairComparisonKey(suggestions)
    ) {
        return [];
    }
    const contextTokens = replySuggestionContextTokens(
        `${latestUserMessage.content}\n${assistantText}`
    );
    return replySuggestionContextAnchorScore(suggestions, contextTokens) >= 2
        ? suggestions
        : [];
}

function parseReplySuggestionToolArguments(value) {
    let parsed;
    try {
        parsed = typeof value === "string" ? JSON.parse(value) : value;
    } catch {
        return { ok: false, error: "回复候选参数不是有效的 JSON。" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "回复候选参数格式不正确。" };
    }
    const keys = Object.keys(parsed);
    if (
        keys.length !== 1 ||
        keys[0] !== "suggestions" ||
        !Array.isArray(parsed.suggestions) ||
        parsed.suggestions.length !== 2
    ) {
        return { ok: false, error: "回复候选必须恰好包含两条文字。" };
    }
    const suggestions = normalizeReplySuggestions(parsed.suggestions);
    if (suggestions.length !== 2) {
        return {
            ok: false,
            error: "两条回复候选必须非空、不同，并符合长度限制。"
        };
    }
    return { ok: true, value: suggestions };
}

function createReplySuggestionSelector() {
    let selectedSuggestions = [];

    async function executeTool(toolCall) {
        if (toolCall?.name !== SELECT_REPLY_SUGGESTIONS_TOOL.name) {
            return { ok: false, error: "未知回复候选工具。" };
        }
        if (selectedSuggestions.length === 2) {
            return { ok: false, error: "本轮已经选择过回复候选。" };
        }
        const parsed = parseReplySuggestionToolArguments(
            toolCall.arguments ?? ""
        );
        if (!parsed.ok) return parsed;
        selectedSuggestions = parsed.value;
        return {
            ok: true,
            reply_suggestions: [...selectedSuggestions],
            message: "回复候选已附加，请继续完成自然的文字回答。"
        };
    }

    return {
        executeTool,
        getSuggestions() {
            return [...selectedSuggestions];
        }
    };
}

function replySuggestionToolCalls(value) {
    const source = Array.isArray(value)
        ? value
        : value?.getSuggestions?.();
    const suggestions = normalizeReplySuggestions(source);
    return suggestions.length === 2
        ? { reply_suggestions: suggestions }
        : {};
}

module.exports = {
    REPLY_SUGGESTION_MAX_CHARS,
    SELECT_REPLY_SUGGESTIONS_TOOL,
    cleanReplySuggestion,
    createReplySuggestionSelector,
    finalizeReplySuggestions,
    normalizeReplySuggestions,
    parseReplySuggestionToolArguments,
    replySuggestionToolCalls
};
