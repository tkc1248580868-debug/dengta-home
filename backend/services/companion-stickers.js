const COMPANION_STICKER_IDS = Object.freeze([
    "bear-sleepy",
    "bear-hug",
    "bear-miss-you",
    "bear-cheer",
    "bear-shy",
    "bear-goodnight"
]);
const COMPANION_STICKER_ID_SET = new Set(COMPANION_STICKER_IDS);

const SELECT_COMPANION_STICKER_TOOL = Object.freeze({
    name: "select_companion_sticker",
    description: [
        "可选地给当前文字回复配一张伴侣原创表情。",
        "这些是应用里已经存在的静态表情，不是本轮新生成、现画或刚做好的图片。",
        "不得声称自己现画、刚生成或新做了它；用户明确要求新做表情时，不要用此工具冒充新作品。",
        "只有表情确实能让当下语气更自然时才调用；每轮最多一张。",
        "只能选择给定 sticker_id，不得输出 URL、文件路径或自定义表情名。",
        "表情不能代替文字回复，调用后仍要完成自然的文字回答。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            sticker_id: {
                type: "string",
                enum: COMPANION_STICKER_IDS,
                description:
                    "sleepy=困倦，hug=拥抱，miss-you=想念，cheer=打气，shy=害羞，goodnight=晚安。"
            }
        },
        required: ["sticker_id"],
        additionalProperties: false
    }
});

function isAllowedCompanionStickerId(value) {
    return (
        typeof value === "string" && COMPANION_STICKER_ID_SET.has(value)
    );
}

function parseCompanionStickerToolArguments(value) {
    let parsed;
    try {
        parsed =
            typeof value === "string" ? JSON.parse(value) : value;
    } catch {
        return { ok: false, error: "表情参数不是有效的 JSON。" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "表情参数格式不正确。" };
    }
    const keys = Object.keys(parsed);
    if (
        keys.length !== 1 ||
        keys[0] !== "sticker_id" ||
        !isAllowedCompanionStickerId(parsed.sticker_id)
    ) {
        return { ok: false, error: "表情只能从内置白名单中选择。" };
    }
    return { ok: true, value: parsed.sticker_id };
}

function createCompanionStickerSelector() {
    let selectedStickerId = "";

    async function executeTool(toolCall) {
        if (toolCall?.name !== SELECT_COMPANION_STICKER_TOOL.name) {
            return { ok: false, error: "未知表情工具。" };
        }
        if (selectedStickerId) {
            return { ok: false, error: "本轮已经选择过一张表情。" };
        }
        const parsed = parseCompanionStickerToolArguments(
            toolCall.arguments ?? ""
        );
        if (!parsed.ok) return parsed;
        selectedStickerId = parsed.value;
        return {
            ok: true,
            sticker_id: selectedStickerId,
            message: "表情已附加，请继续完成文字回复。"
        };
    }

    return {
        executeTool,
        getStickerId() {
            return selectedStickerId;
        }
    };
}

function companionStickerToolCalls(value) {
    const stickerId =
        typeof value === "string" ? value : value?.getStickerId?.();
    return isAllowedCompanionStickerId(stickerId)
        ? { sticker_id: stickerId }
        : {};
}

module.exports = {
    COMPANION_STICKER_IDS,
    SELECT_COMPANION_STICKER_TOOL,
    companionStickerToolCalls,
    createCompanionStickerSelector,
    isAllowedCompanionStickerId,
    parseCompanionStickerToolArguments
};
