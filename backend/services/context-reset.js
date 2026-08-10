const {
    memoryBudgetEnabled,
    selectMemoriesForContext
} = require("./memory-budget");
const { isNurseryRelevant } = require("./nursery-engine");
const { loadNurseryRuntimeSnapshot } = require("./nursery");
const {
    filterMemoriesForContext,
    filterProviderBoundaryMessages
} = require("./persistent-memory-filter");

function normalizeContextResetAt(value) {
    const candidate =
        value && typeof value === "object"
            ? value.context_reset_at
            : value;
    if (candidate === null || candidate === undefined || candidate === "") {
        return null;
    }
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isContextTimestampCurrent(value, settings) {
    const cutoff = normalizeContextResetAt(settings);
    if (!cutoff) return true;
    const parsed = new Date(value);
    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.getTime() >= new Date(cutoff).getTime()
    );
}

function applyContextResetCutoff(
    query,
    settings,
    column = "created_at"
) {
    const cutoff = normalizeContextResetAt(settings);
    return cutoff ? query.gte(column, cutoff) : query;
}

function confirmedMemoryQuery(database, settings, limit) {
    const query = database
        .from("memories")
        .select("id, summary, created_at, updated_at")
        .eq("confirmation_status", "confirmed");
    return applyContextResetCutoff(query, settings)
        .order("updated_at", { ascending: false })
        .limit(limit);
}

async function loadMainChatContextRows({
    database,
    conversationId,
    settings
}) {
    const useMemoryBudget = memoryBudgetEnabled();
    const messageLimit = Math.max(
        2,
        Number(settings?.context_turns || 20) * 2
    );
    const historyQuery = applyContextResetCutoff(
        database
            .from("messages")
            .select("id, role, content, created_at, tool_calls")
            .eq("conversation_id", conversationId)
            .eq("visible", true),
        settings
    )
        .order("created_at", { ascending: false })
        .limit(messageLimit);
    const [historyResult, memoriesResult] = await Promise.all([
        historyQuery,
        confirmedMemoryQuery(database, settings, useMemoryBudget ? 40 : 5)
    ]);
    if (historyResult.error) throw historyResult.error;
    if (memoriesResult.error) throw memoriesResult.error;
    const messages = filterProviderBoundaryMessages(
        (historyResult.data || []).reverse()
    );
    const latestUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user");
    let nursery = null;
    if (isNurseryRelevant(latestUserMessage?.content || "")) {
        nursery = await loadNurseryRuntimeSnapshot({ database }).catch(
            (error) => {
                if (
                    error?.code === "42P01" ||
                    error?.code === "PGRST205" ||
                    /nursery_.*does not exist|could not find.*nursery_/i.test(
                        error?.message || ""
                    )
                ) {
                    return null;
                }
                throw error;
            }
        );
    }
    return {
        messages,
        memories: useMemoryBudget
            ? selectMemoriesForContext(filterMemoriesForContext(memoriesResult.data), {
                  query: latestUserMessage?.content || ""
              })
            : filterMemoriesForContext(memoriesResult.data).slice(0, 5),
        nursery
    };
}

async function loadCompanionInteractionContextRows({
    database,
    conversationId,
    settings
}) {
    const baseMessageQuery = () =>
        applyContextResetCutoff(
            database
                .from("messages")
                .select(
                    "id, role, content, created_at, tool_calls"
                )
                .eq("conversation_id", conversationId)
                .eq("visible", true),
            settings
        );
    const [userResult, assistantResult, interactionResult, memoriesResult] =
        await Promise.all([
            baseMessageQuery()
                .eq("role", "user")
                .order("created_at", { ascending: false })
                .limit(8),
            baseMessageQuery()
                .eq("role", "assistant")
                .not(
                    "tool_calls",
                    "cs",
                    JSON.stringify({ is_companion_interaction: true })
                )
                .order("created_at", { ascending: false })
                .limit(8),
            baseMessageQuery()
                .eq("role", "assistant")
                .contains("tool_calls", {
                    is_companion_interaction: true
                })
                .order("created_at", { ascending: false })
                .limit(6),
            confirmedMemoryQuery(database, settings, 1)
        ]);
    for (const result of [
        userResult,
        assistantResult,
        interactionResult,
        memoriesResult
    ]) {
        if (result.error) throw result.error;
    }
    const messagesById = new Map();
    for (const message of [
        ...(userResult.data || []),
        ...(assistantResult.data || []),
        ...(interactionResult.data || [])
    ]) {
        messagesById.set(message.id, message);
    }
    return {
        messages: filterProviderBoundaryMessages(
            [...messagesById.values()].sort(
                (left, right) =>
                    Date.parse(left.created_at) -
                    Date.parse(right.created_at)
            )
        ),
        memories: filterMemoriesForContext(memoriesResult.data)
    };
}

async function loadMemoryCompressionRows({
    database,
    conversationId,
    settings
}) {
    const messagesQuery = applyContextResetCutoff(
        database
            .from("messages")
            .select("id, role, content, created_at")
            .eq("conversation_id", conversationId)
            .eq("visible", true),
        settings
    ).order("created_at", { ascending: true });
    const [messagesResult, memoriesResult] = await Promise.all([
        messagesQuery,
        confirmedMemoryQuery(database, settings, 5)
    ]);
    if (messagesResult.error) throw messagesResult.error;
    if (memoriesResult.error) throw memoriesResult.error;
    return {
        messages: filterProviderBoundaryMessages(messagesResult.data),
        memories: filterMemoriesForContext(memoriesResult.data)
    };
}

module.exports = {
    applyContextResetCutoff,
    isContextTimestampCurrent,
    loadCompanionInteractionContextRows,
    loadMainChatContextRows,
    loadMemoryCompressionRows,
    normalizeContextResetAt
};
