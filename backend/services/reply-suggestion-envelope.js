const { randomBytes } = require("node:crypto");
const {
    SELECT_REPLY_SUGGESTIONS_TOOL,
    normalizeReplySuggestions
} = require("./reply-suggestions");
const {
    UPDATE_COMPANION_STATUS_TOOL,
    validateCompanionStatusToolArguments
} = require("./companion-status");

const REPLY_SUGGESTION_ENVELOPE_VERSION = "v1";
const REPLY_SUGGESTION_ENVELOPE_MAX_CHARS = 4096;
const REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX =
    "<<<DENGTA_REPLY_SUGGESTIONS_V1:";
const REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX =
    "<<<END_DENGTA_REPLY_SUGGESTIONS_V1:";

function trailingPrefixLength(value, tokens) {
    const normalizedValue = value.toLowerCase();
    let retained = 0;
    for (const token of tokens) {
        const normalizedToken = token.toLowerCase();
        const maximum = Math.min(normalizedValue.length, token.length - 1);
        for (let length = maximum; length > retained; length -= 1) {
            if (
                normalizedValue.endsWith(
                    normalizedToken.slice(0, length)
                )
            ) {
                retained = length;
                break;
            }
        }
    }
    return retained;
}

function safeEnvelopeNonce(value) {
    const nonce = String(value || "").trim().toLowerCase();
    return /^[a-f0-9]{32}$/.test(nonce)
        ? nonce
        : randomBytes(16).toString("hex");
}

function buildReplySuggestionEnvelopeInstruction({
    openMarker,
    closeMarker,
    includeReplySuggestions,
    includeCompanionStatus
}) {
    const lines = [
        "【DengTa 本轮隐藏元数据协议】",
        "先完整写出本轮给对方看的自然回复，再判断是否需要在正文最后紧接一行隐藏协议。"
    ];
    const example = {};

    if (includeCompanionStatus) {
        lines.push(
            UPDATE_COMPANION_STATUS_TOOL.description,
            "每轮都要结合最新消息、近期对话和当前状态检查自己的情绪与状态。只要 mood、place、focus、note、energy_level、pulse_bpm、hot_zones 或 micro_state 中任一项发生变化，就必须在 companion_status 中给出全部八个字段；只有八项都没有变化时才省略它。"
        );
        example.companion_status = {
            mood: "开心",
            place: "DengTa home",
            focus: "继续聊刚才的话题",
            note: "这句话让我心里亮了一下。",
            energy_level: 72,
            pulse_bpm: 80,
            hot_zones: ["heart"],
            micro_state: "忍不住靠近了一点"
        };
    }
    if (includeReplySuggestions) {
        lines.push(
            SELECT_REPLY_SUGGESTIONS_TOOL.description,
            "只有确实能生成两条合适候选时才写 suggestions，否则省略它。"
        );
        example.suggestions = ["第一条候选", "第二条候选"];
    }

    lines.push(
        `${openMarker}${JSON.stringify(example)}${closeMarker}`,
        `协议 JSON 只能包含${includeCompanionStatus ? " companion_status" : ""}${
            includeCompanionStatus && includeReplySuggestions ? " 和" : ""
        }${includeReplySuggestions ? " suggestions" : ""}；没有任何元数据时完全省略整段协议。不要使用 Markdown 代码块，不要解释协议，不要在结束标记后输出除空白外的任何内容。`
    );
    return lines.join("\n");
}

function emptyEnvelopeMetadata() {
    return { suggestions: [], companionStatus: null };
}

function parseReplySuggestionEnvelopeMetadata(
    value,
    {
        includeReplySuggestions = true,
        includeCompanionStatus = false
    } = {}
) {
    const source = String(value || "");
    if (
        !source ||
        Array.from(source).length > REPLY_SUGGESTION_ENVELOPE_MAX_CHARS
    ) {
        return emptyEnvelopeMetadata();
    }

    let parsed;
    try {
        parsed = JSON.parse(source);
    } catch {
        return emptyEnvelopeMetadata();
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return emptyEnvelopeMetadata();
    }
    const keys = Object.keys(parsed);
    const allowedKeys = new Set([
        ...(includeReplySuggestions ? ["suggestions"] : []),
        ...(includeCompanionStatus ? ["companion_status"] : [])
    ]);
    if (
        keys.length === 0 ||
        keys.some((key) => !allowedKeys.has(key))
    ) {
        return emptyEnvelopeMetadata();
    }

    let suggestions = [];
    if (Object.hasOwn(parsed, "suggestions")) {
        suggestions = normalizeReplySuggestions(parsed.suggestions);
        if (suggestions.length !== 2) return emptyEnvelopeMetadata();
    }

    let companionStatus = null;
    if (Object.hasOwn(parsed, "companion_status")) {
        const validated = validateCompanionStatusToolArguments(
            parsed.companion_status
        );
        if (!validated.ok) return emptyEnvelopeMetadata();
        companionStatus = validated.value;
    }

    return { suggestions, companionStatus };
}

function parseReplySuggestionEnvelopePayload(value) {
    return parseReplySuggestionEnvelopeMetadata(value).suggestions;
}

function createReplySuggestionEnvelopeFilter({
    nonce,
    openMarker,
    closeMarker,
    includeReplySuggestions,
    includeCompanionStatus
}) {
    const hiddenPrefixes = [
        REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX,
        REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX
    ];
    let visibleBuffer = "";
    let hiddenBuffer = "";
    let hiddenStarted = false;
    let openingComplete = false;
    let hiddenClosed = false;
    let invalid = false;
    let payload = "";
    let payloadCharacters = 0;
    let tailHasNonWhitespace = false;

    function appendPayload(value) {
        if (invalid || !value) return;
        const characters = Array.from(value);
        if (
            payloadCharacters + characters.length >
            REPLY_SUGGESTION_ENVELOPE_MAX_CHARS
        ) {
            invalid = true;
            payload = "";
            payloadCharacters = 0;
            return;
        }
        payload += value;
        payloadCharacters += characters.length;
    }

    function consumeHidden(value) {
        if (!value) return;
        if (invalid) return;
        if (hiddenClosed) {
            if (/\S/u.test(value)) tailHasNonWhitespace = true;
            return;
        }

        hiddenBuffer += value;
        if (!openingComplete) {
            const markerEnd = hiddenBuffer.indexOf(">>>");
            if (markerEnd < 0) {
                if (hiddenBuffer.length > openMarker.length) {
                    invalid = true;
                    hiddenBuffer = "";
                }
                return;
            }

            const emittedMarker = hiddenBuffer.slice(0, markerEnd + 3);
            if (emittedMarker.toLowerCase() !== openMarker.toLowerCase()) {
                invalid = true;
            }
            openingComplete = true;
            hiddenBuffer = hiddenBuffer.slice(markerEnd + 3);
            if (invalid) {
                hiddenBuffer = "";
                return;
            }
        }

        const closeIndex = hiddenBuffer
            .toLowerCase()
            .indexOf(closeMarker.toLowerCase());
        if (closeIndex >= 0) {
            appendPayload(hiddenBuffer.slice(0, closeIndex));
            if (
                /\S/u.test(
                    hiddenBuffer.slice(closeIndex + closeMarker.length)
                )
            ) {
                tailHasNonWhitespace = true;
            }
            hiddenBuffer = "";
            hiddenClosed = true;
            return;
        }

        const retained = trailingPrefixLength(hiddenBuffer, [closeMarker]);
        const consumableLength = hiddenBuffer.length - retained;
        if (consumableLength <= 0) return;

        appendPayload(hiddenBuffer.slice(0, consumableLength));
        hiddenBuffer = hiddenBuffer.slice(consumableLength);
    }

    function startHidden(value, markerIndex) {
        const visible = value.slice(0, markerIndex);
        hiddenStarted = true;
        visibleBuffer = "";
        consumeHidden(value.slice(markerIndex));
        return visible;
    }

    function push(value) {
        const chunk = String(value || "");
        if (!chunk) return "";
        if (hiddenStarted) {
            consumeHidden(chunk);
            return "";
        }

        visibleBuffer += chunk;
        const normalizedVisibleBuffer = visibleBuffer.toLowerCase();
        const openIndex = normalizedVisibleBuffer.indexOf(
            REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX.toLowerCase()
        );
        const strayCloseIndex = normalizedVisibleBuffer.indexOf(
            REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX.toLowerCase()
        );
        const markerIndexes = [openIndex, strayCloseIndex].filter(
            (index) => index >= 0
        );
        if (markerIndexes.length > 0) {
            const markerIndex = Math.min(...markerIndexes);
            if (markerIndex === strayCloseIndex) invalid = true;
            return startHidden(visibleBuffer, markerIndex);
        }

        const retained = trailingPrefixLength(visibleBuffer, hiddenPrefixes);
        const visibleLength = visibleBuffer.length - retained;
        const visible = visibleBuffer.slice(0, visibleLength);
        visibleBuffer = visibleBuffer.slice(visibleLength);
        return visible;
    }

    function finish() {
        if (!hiddenStarted) {
            const visible =
                visibleBuffer.length <= 3 ? visibleBuffer : "";
            visibleBuffer = "";
            return visible;
        }
        hiddenBuffer = "";
        return "";
    }

    function getMetadata() {
        if (
            !hiddenStarted ||
            !hiddenClosed ||
            invalid ||
            tailHasNonWhitespace ||
            !openMarker.endsWith(`${nonce}>>>`) ||
            !closeMarker.endsWith(`${nonce}>>>`)
        ) {
            return emptyEnvelopeMetadata();
        }
        return parseReplySuggestionEnvelopeMetadata(payload, {
            includeReplySuggestions,
            includeCompanionStatus
        });
    }

    return {
        push,
        finish,
        getSuggestions() {
            return getMetadata().suggestions;
        },
        getCompanionStatus() {
            return getMetadata().companionStatus;
        },
        getMetadata
    };
}

function createReplySuggestionEnvelopeProtocol(options = {}) {
    const nonce = safeEnvelopeNonce(options.nonce);
    const includeReplySuggestions =
        options.includeReplySuggestions !== false;
    const includeCompanionStatus = options.includeCompanionStatus === true;
    const openMarker = `${REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX}${nonce}>>>`;
    const closeMarker = `${REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX}${nonce}>>>`;
    return Object.freeze({
        version: REPLY_SUGGESTION_ENVELOPE_VERSION,
        nonce,
        openMarker,
        closeMarker,
        instruction: buildReplySuggestionEnvelopeInstruction({
            openMarker,
            closeMarker,
            includeReplySuggestions,
            includeCompanionStatus
        }),
        createFilter() {
            return createReplySuggestionEnvelopeFilter({
                nonce,
                openMarker,
                closeMarker,
                includeReplySuggestions,
                includeCompanionStatus
            });
        },
        filterText(value) {
            const filter = createReplySuggestionEnvelopeFilter({
                nonce,
                openMarker,
                closeMarker,
                includeReplySuggestions,
                includeCompanionStatus
            });
            const text = `${filter.push(value)}${filter.finish()}`;
            const result = {
                text,
                suggestions: filter.getSuggestions()
            };
            if (includeCompanionStatus) {
                result.companionStatus = filter.getCompanionStatus();
            }
            return result;
        }
    });
}

async function executeReplySuggestionEnvelope(suggestions, executeTool) {
    const normalized = normalizeReplySuggestions(suggestions);
    if (normalized.length !== 2 || typeof executeTool !== "function") {
        return false;
    }

    try {
        const result = await executeTool({
            id: "reply_suggestions_envelope_v1",
            name: SELECT_REPLY_SUGGESTIONS_TOOL.name,
            arguments: JSON.stringify({ suggestions: normalized })
        });
        return result?.ok === true;
    } catch {
        return false;
    }
}

async function executeReplySuggestionEnvelopeMetadata(metadata, executeTool) {
    if (typeof executeTool !== "function") {
        return { companionStatus: false, suggestions: false };
    }

    let companionStatus = false;
    const validatedStatus = validateCompanionStatusToolArguments(
        metadata?.companionStatus
    );
    if (validatedStatus.ok) {
        try {
            const result = await executeTool({
                id: "companion_status_envelope_v1",
                name: UPDATE_COMPANION_STATUS_TOOL.name,
                arguments: JSON.stringify(validatedStatus.value)
            });
            companionStatus = result?.ok === true;
        } catch {
            companionStatus = false;
        }
    }

    const suggestions = await executeReplySuggestionEnvelope(
        metadata?.suggestions,
        executeTool
    );
    return { companionStatus, suggestions };
}

module.exports = {
    REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX,
    REPLY_SUGGESTION_ENVELOPE_MAX_CHARS,
    REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX,
    REPLY_SUGGESTION_ENVELOPE_VERSION,
    createReplySuggestionEnvelopeProtocol,
    executeReplySuggestionEnvelope,
    executeReplySuggestionEnvelopeMetadata,
    parseReplySuggestionEnvelopeMetadata,
    parseReplySuggestionEnvelopePayload
};
