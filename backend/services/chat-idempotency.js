const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHAT_GENERATION_LEASE_SECONDS = 10 * 60;
const CHAT_GENERATION_HEARTBEAT_MS = 30 * 1000;

function normalizeClientMessageId(value) {
    const cleaned = String(value ?? "").trim();
    if (!cleaned) return "";
    if (!UUID_PATTERN.test(cleaned)) {
        const error = new Error("客户端消息编号格式不正确。");
        error.status = 400;
        error.code = "INVALID_CLIENT_MESSAGE_ID";
        throw error;
    }
    return cleaned.toLowerCase();
}

function isClientMessageUniqueConflict(error) {
    if (error?.code !== "23505") return false;
    return /client_message_id|messages_client_message_id/i.test(
        [error?.message, error?.details, error?.hint].filter(Boolean).join(" ")
    );
}

function assertClientMessageConversation(message, conversationId) {
    if (!message || !conversationId) return;
    if (String(message.conversation_id) === String(conversationId)) return;

    const error = new Error("这个客户端消息编号已经用于另一个会话。");
    error.status = 409;
    error.code = "CLIENT_MESSAGE_CONVERSATION_CONFLICT";
    throw error;
}

function chatGenerationInProgressError() {
    const error = new Error(
        "这条消息已经保存，AI 仍在处理中。请稍后刷新聊天记录。"
    );
    error.status = 409;
    error.code = "CHAT_GENERATION_IN_PROGRESS";
    return error;
}

function generationLeaseFields(
    leaseId,
    now = Date.now(),
    leaseSeconds = CHAT_GENERATION_LEASE_SECONDS
) {
    const startedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + leaseSeconds * 1000).toISOString();
    return {
        chat_generation_state: "in_progress",
        chat_generation_lease_id: leaseId,
        chat_generation_lease_expires_at: expiresAt,
        chat_generation_started_at: startedAt,
        chat_generation_failed_at: null,
        chat_generation_completed_at: null
    };
}

function shouldResumeClientMessageGeneration(
    message,
    now = Date.now(),
    staleAfterMs = 5 * 60 * 1000
) {
    const toolCalls =
        message?.tool_calls && typeof message.tool_calls === "object"
            ? message.tool_calls
            : {};
    const state =
        message?.chat_generation_state || toolCalls.chat_generation_state;
    if (state !== "in_progress") return state !== "completed";

    const leaseExpiresAt = Date.parse(
        message?.chat_generation_lease_expires_at ||
            toolCalls.chat_generation_lease_expires_at ||
            ""
    );
    if (Number.isFinite(leaseExpiresAt)) return now >= leaseExpiresAt;

    const startedAt = Date.parse(
        message?.chat_generation_started_at ||
            toolCalls.chat_generation_started_at ||
            ""
    );
    if (!Number.isFinite(startedAt)) return true;
    return now - startedAt >= staleAfterMs;
}

function normalizeRpcObject(data) {
    return Array.isArray(data) ? data[0] || null : data;
}

function normalizeIdempotencyOwnership(ownership) {
    const userId = String(ownership?.userId || "").trim();
    const companionId = String(ownership?.companionId || "").trim();
    if (!userId && !companionId) return null;
    if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(companionId)) {
        throw new TypeError(
            "Idempotency ownership requires valid userId and companionId UUIDs."
        );
    }
    return {
        userId: userId.toLowerCase(),
        companionId: companionId.toLowerCase()
    };
}

function withRpcOwnership(params, ownership) {
    const normalized = normalizeIdempotencyOwnership(ownership);
    if (!normalized) return params;
    return {
        ...params,
        p_user_id: normalized.userId,
        p_companion_id: normalized.companionId
    };
}

function createChatGenerationLeaseStore(
    client,
    { leaseSeconds = CHAT_GENERATION_LEASE_SECONDS } = {}
) {
    if (!client || typeof client.rpc !== "function") {
        throw new TypeError("Supabase client with rpc() is required.");
    }

    async function call(name, params) {
        const { data, error } = await client.rpc(name, params);
        if (error) throw error;
        return normalizeRpcObject(data);
    }

    return {
        async claim(clientMessageId, leaseId, ownership) {
            return call(
                "claim_chat_generation",
                withRpcOwnership(
                    {
                        p_client_message_id: clientMessageId,
                        p_lease_id: leaseId,
                        p_lease_seconds: leaseSeconds
                    },
                    ownership
                )
            );
        },

        async renew(clientMessageId, leaseId, ownership) {
            return (
                (await call(
                    "renew_chat_generation_lease",
                    withRpcOwnership(
                        {
                            p_client_message_id: clientMessageId,
                            p_lease_id: leaseId,
                            p_lease_seconds: leaseSeconds
                        },
                        ownership
                    )
                )) === true
            );
        },

        async commit({
            userId,
            companionId,
            clientMessageId,
            leaseId,
            content,
            toolCalls,
            visible = true
        }) {
            return call(
                "commit_chat_generation_reply",
                withRpcOwnership(
                    {
                        p_client_message_id: clientMessageId,
                        p_lease_id: leaseId,
                        p_content: content,
                        p_tool_calls: toolCalls || {},
                        p_visible: visible !== false
                    },
                    { userId, companionId }
                )
            );
        },

        async fail(clientMessageId, leaseId, ownership) {
            return (
                (await call(
                    "fail_chat_generation_lease",
                    withRpcOwnership(
                        {
                            p_client_message_id: clientMessageId,
                            p_lease_id: leaseId
                        },
                        ownership
                    )
                )) === true
            );
        }
    };
}

function createChatGenerationLeaseHeartbeat({
    renew,
    intervalMs = CHAT_GENERATION_HEARTBEAT_MS
}) {
    if (typeof renew !== "function") {
        throw new TypeError("renew must be a function.");
    }

    let stopped = false;
    let lost = false;
    let pending = Promise.resolve();

    async function pulse() {
        if (stopped || lost) return;
        try {
            if ((await renew()) !== true) lost = true;
        } catch {
            // A later explicit ownership check retries the database call.
        }
    }

    const timer = setInterval(() => {
        pending = pending.then(pulse, pulse);
    }, Math.max(1000, Number(intervalMs) || CHAT_GENERATION_HEARTBEAT_MS));
    timer.unref?.();

    return {
        async assertOwned() {
            await pending;
            if (lost) throw chatGenerationInProgressError();
            if ((await renew()) !== true) {
                lost = true;
                throw chatGenerationInProgressError();
            }
        },

        async stop() {
            stopped = true;
            clearInterval(timer);
            await pending;
        }
    };
}

function createClientMessageQueue() {
    const tails = new Map();

    return async function runClientMessageTask(
        clientMessageId,
        task,
        ownership
    ) {
        if (!clientMessageId) return task();

        const normalizedOwnership = normalizeIdempotencyOwnership(ownership);
        const queueKey = normalizedOwnership
            ? `${normalizedOwnership.userId}:${normalizedOwnership.companionId}:${clientMessageId}`
            : clientMessageId;
        const previous = tails.get(queueKey) || Promise.resolve();
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const tail = previous.catch(() => {}).then(() => gate);
        tails.set(queueKey, tail);

        await previous.catch(() => {});
        try {
            return await task();
        } finally {
            release();
            if (tails.get(queueKey) === tail) {
                tails.delete(queueKey);
            }
        }
    };
}

module.exports = {
    CHAT_GENERATION_HEARTBEAT_MS,
    CHAT_GENERATION_LEASE_SECONDS,
    assertClientMessageConversation,
    chatGenerationInProgressError,
    createChatGenerationLeaseHeartbeat,
    createChatGenerationLeaseStore,
    createClientMessageQueue,
    generationLeaseFields,
    isClientMessageUniqueConflict,
    normalizeClientMessageId,
    shouldResumeClientMessageGeneration
};
