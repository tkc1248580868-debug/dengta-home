const CO_WATCH_PROMPT_ARCHITECTURE = "main-chat";
const CO_WATCH_MAX_REACTION_CHARS = 420;

function cleanText(value, limit = CO_WATCH_MAX_REACTION_CHARS) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, limit)
        .join("");
}

function boundedInteger(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function normalizeCoWatchFrame(value = {}) {
    const sessionId = cleanText(value.sessionId, 80);
    if (!/^[0-9a-f-]{16,80}$/i.test(sessionId)) {
        const error = new Error("共看会话编号无效。");
        error.status = 400;
        error.code = "co_watch_session_invalid";
        throw error;
    }
    const capturedAt = new Date(value.capturedAt);
    return Object.freeze({
        sessionId,
        epoch: boundedInteger(value.epoch, 1, Number.MAX_SAFE_INTEGER, 1),
        sequence: boundedInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER, 1),
        capturedAt: Number.isFinite(capturedAt.getTime())
            ? capturedAt.toISOString()
            : new Date().toISOString(),
        mimeType:
            value.mimeType === "image/png" ? "image/png" : "image/jpeg"
    });
}

function buildCoWatchPrompt({ capturedAt } = {}) {
    return [
        "我们正在一起看我手机屏幕上的内容。刚刚共享了一张新的画面，请把它当作此刻共同观看的现场。",
        "结合最近对话、你的个性化指令、记忆、此刻心情和画面，自主决定你真正想说的一两句话。可以注意标题、人物、情节、画面或声音线索；可以吐槽、惊讶、喜欢、疑惑、沉默片刻后再说，也可以问我一句。",
        "不要写分析报告，不要解释你正在识图，不要使用固定模板。像坐在我身边一起看一样自然，通常控制在 15 到 90 个汉字。",
        capturedAt ? `画面时间：${capturedAt}` : ""
    ]
        .filter(Boolean)
        .join("\n");
}

async function findLatestConversation(database) {
    const { data, error } = await database
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

async function findExistingReaction(database, frame) {
    const { data, error } = await database
        .from("messages")
        .select("id, conversation_id, content, created_at")
        .eq("role", "assistant")
        .contains("tool_calls", {
            is_co_watch: true,
            co_watch_session_id: frame.sessionId,
            co_watch_epoch: frame.epoch,
            co_watch_sequence: frame.sequence
        })
        .order("created_at", { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

async function runCoWatchFrame({
    database,
    frame,
    image,
    getSettings,
    loadChatContext,
    generateReply,
    saveMessage,
    touchConversation,
    findConversation = findLatestConversation,
    findReaction = findExistingReaction
} = {}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    for (const [name, dependency] of Object.entries({
        getSettings,
        loadChatContext,
        generateReply,
        saveMessage,
        touchConversation,
        findConversation,
        findReaction
    })) {
        if (typeof dependency !== "function") {
            throw new TypeError(`${name} must be a function.`);
        }
    }
    const normalizedFrame = normalizeCoWatchFrame(frame);
    if (!Buffer.isBuffer(image) || image.length === 0) {
        const error = new Error("共看画面为空。");
        error.status = 400;
        error.code = "co_watch_frame_empty";
        throw error;
    }

    const existing = await findReaction(database, normalizedFrame);
    if (existing) {
        return {
            status: "replayed",
            reaction: existing.content,
            messageId: existing.id,
            conversationId: existing.conversation_id
        };
    }

    const [conversation, settings] = await Promise.all([
        findConversation(database),
        getSettings(database)
    ]);
    if (!conversation?.id) {
        const error = new Error("请先在 DengTa 中开始一段聊天，再邀请伴侣一起看。");
        error.status = 409;
        error.code = "co_watch_conversation_missing";
        throw error;
    }
    const context = await loadChatContext(
        conversation.id,
        settings,
        database
    );
    const generated = await generateReply({
        settings: {
            ...settings,
            temperature: Math.max(0.7, Number(settings.temperature || 0.8)),
            max_tokens: Math.min(320, Math.max(120, Number(settings.max_tokens || 220)))
        },
        messages: [
            ...(Array.isArray(context?.messages) ? context.messages : []),
            {
                role: "user",
                content: buildCoWatchPrompt(normalizedFrame)
            }
        ],
        memories: Array.isArray(context?.memories) ? context.memories : [],
        runtimeContext: "",
        turnContext: "",
        promptArchitecture: CO_WATCH_PROMPT_ARCHITECTURE,
        attachments: [
            {
                mimeType: normalizedFrame.mimeType,
                data: image.toString("base64")
            }
        ],
        purpose: "co_watch"
    });
    const reaction = cleanText(generated?.text);
    if (!reaction) {
        const error = new Error("伴侣这次没有生成可显示的共看反应。");
        error.status = 502;
        error.code = "co_watch_reaction_empty";
        throw error;
    }
    const saved = await saveMessage(
        conversation.id,
        "assistant",
        reaction,
        {
            visible: true,
            tool_calls: {
                is_push: true,
                is_co_watch: true,
                co_watch_session_id: normalizedFrame.sessionId,
                co_watch_epoch: normalizedFrame.epoch,
                co_watch_sequence: normalizedFrame.sequence,
                co_watch_captured_at: normalizedFrame.capturedAt,
                response_mode: generated?.mode || "unknown"
            },
            database
        }
    );
    await touchConversation(conversation.id, database);
    return {
        status: "created",
        reaction,
        messageId: saved.id,
        conversationId: conversation.id,
        aiName: cleanText(settings.ai_name || "伴侣", 50)
    };
}

module.exports = {
    CO_WATCH_MAX_REACTION_CHARS,
    buildCoWatchPrompt,
    findExistingReaction,
    findLatestConversation,
    normalizeCoWatchFrame,
    runCoWatchFrame
};
