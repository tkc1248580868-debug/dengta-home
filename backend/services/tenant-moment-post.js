const {
    stableUuid
} = require("./tenant-proactive-message");
const {
    applyContextResetCutoff
} = require("./context-reset");

const MIN_NEXT_CHECK_MINUTES = 1;
const MAX_NEXT_CHECK_MINUTES = 14 * 60;
const MIN_SEED_DELAY_MINUTES = 30;
const MAX_SEED_DELAY_MINUTES = 10 * 60;

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function randomInteger(min, max, random = Math.random) {
    const sample = Number(random());
    const normalized = Number.isFinite(sample)
        ? Math.min(0.999999999999, Math.max(0, sample))
        : 0.5;
    return min + Math.floor(normalized * (max - min + 1));
}

function parseMomentPostDecision(text, random = Math.random) {
    const source = String(text || "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    let parsed = {};
    try {
        if (start >= 0 && end > start) {
            parsed = JSON.parse(source.slice(start, end + 1));
        }
    } catch {
        parsed = {};
    }

    const content = cleanText(parsed.content, 1000);
    const requestedMinutes = Number(parsed.next_check_minutes);
    const nextCheckMinutes = Number.isInteger(requestedMinutes)
        ? Math.min(
              MAX_NEXT_CHECK_MINUTES,
              Math.max(MIN_NEXT_CHECK_MINUTES, requestedMinutes)
          )
        : randomInteger(60, MAX_SEED_DELAY_MINUTES, random);
    return {
        post: parsed.post === true && Boolean(content),
        content,
        nextCheckMinutes
    };
}

function buildMomentPostDecisionPrompt({ now, timezone }) {
    const currentTime = new Date(
        typeof now === "function" ? now() : now
    ).toISOString();
    return [
        "这是一次是否自主发布动态的内部评估，不是用户正在等待的聊天回复。",
        "请结合前面的真实聊天、稳定记忆与最近动态，自主决定这一次是否想写一条公开给当前用户看的碎碎念。",
        "动态可以想念、分享心情、开玩笑、抱怨、闹别扭、保持距离，也可以什么都不发；不要为了完成任务强行发布。",
        "沿用个性化指令决定的叙事世界与经历设定，让动态保持人物、时间和情绪上的连贯。",
        "如果发布，content 必须像当前角色本人自然写下的一条动态，不要提后台任务、评估、倒计时或系统。",
        `当前参考时间：${currentTime}；用户时区：${cleanText(timezone, 80) || "Asia/Shanghai"}。`,
        "next_check_minutes 表示下一次内部评估机会，可在 1 到 840 分钟之间；它不会展示给用户。",
        '严格输出一行 JSON：{"post":true或false,"content":"不超过1000字，允许为空","next_check_minutes":1到840的整数}。不要输出解释。'
    ].join("\n");
}

async function latestConversation(database) {
    const { data, error } = await database
        .from("conversations")
        .select("id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function recentMomentContext(database, settings) {
    const query = applyContextResetCutoff(
        database
            .from("moments")
            .select("author, content, created_at"),
        settings
    )
        .order("created_at", { ascending: false })
        .limit(8);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? [...data].reverse() : [];
    if (!rows.length) return "最近还没有公开动态。";
    return [
        "【最近公开动态】",
        ...rows.map(
            (item) =>
                `[${cleanText(item.created_at, 40)}] ${
                    item.author === "assistant" ? "AI" : "用户"
                }：${cleanText(item.content, 500)}`
        )
    ].join("\n");
}

async function savedMomentForJob(database, jobId) {
    const id = stableUuid("moment-post", jobId);
    const { data, error } = await database
        .from("moments")
        .select("id, content, created_at")
        .eq("id", id)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function pendingMomentPostJob(database) {
    const { data, error } = await database
        .from("background_jobs")
        .select("id, due_at")
        .eq("job_type", "moment_post")
        .eq("status", "pending")
        .order("due_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function scheduleMomentPostEvaluation({
    database,
    sourceMessageId,
    predecessorJobId,
    reconciliationId,
    delayMinutes,
    now = () => new Date(),
    random = Math.random
}) {
    const existing = await pendingMomentPostJob(database);
    if (existing) {
        return {
            scheduled: false,
            reason: "already_pending",
            jobId: existing.id
        };
    }

    const normalizedDelay = Number.isInteger(Number(delayMinutes))
        ? Math.min(
              MAX_NEXT_CHECK_MINUTES,
              Math.max(MIN_NEXT_CHECK_MINUTES, Number(delayMinutes))
          )
        : randomInteger(
              MIN_SEED_DELAY_MINUTES,
              MAX_SEED_DELAY_MINUTES,
              random
          );
    const normalizedReconciliationId = cleanText(reconciliationId, 100);
    const source = predecessorJobId
        ? `job:${cleanText(predecessorJobId, 100)}`
        : sourceMessageId !== undefined && sourceMessageId !== null
          ? `message:${cleanText(sourceMessageId, 100)}`
          : normalizedReconciliationId
            ? `reconciliation:${normalizedReconciliationId}`
            : "";
    if (!source || source.endsWith(":")) {
        throw new TypeError(
            "A source message, predecessor job, or reconciliation ID is required."
        );
    }
    const dueAt = new Date(
        new Date(now()).getTime() + normalizedDelay * 60 * 1000
    ).toISOString();
    const inserted = await database
        .from("background_jobs")
        .insert({
            job_type: "moment_post",
            due_at: dueAt,
            dedupe_key: `moment-post:${source}`,
            payload: {
                reason: predecessorJobId
                    ? "recurring_evaluation"
                    : normalizedReconciliationId
                      ? "reconciliation"
                      : "chat_activity",
                ...(predecessorJobId
                    ? { predecessor_job_id: predecessorJobId }
                    : normalizedReconciliationId
                      ? { reconciliation_id: normalizedReconciliationId }
                      : { source_message_id: String(sourceMessageId) })
            }
        })
        .select("id, due_at")
        .maybeSingle();
    if (!inserted.error) {
        return {
            scheduled: true,
            reason: "scheduled",
            jobId: inserted.data?.id || null,
            dueAt
        };
    }
    if (inserted.error.code !== "23505") throw inserted.error;

    const concurrent = await pendingMomentPostJob(database);
    if (!concurrent) throw inserted.error;
    return {
        scheduled: false,
        reason: "already_pending",
        jobId: concurrent.id
    };
}

async function insertMomentForJob({
    database,
    jobId,
    content,
    now
}) {
    const id = stableUuid("moment-post", jobId);
    const timestamp = new Date(now()).toISOString();
    const inserted = await database
        .from("moments")
        .insert({
            id,
            author: "assistant",
            content,
            context_note: `background_job_id:${jobId}`,
            images: [],
            reply_due_at: timestamp,
            reply_status: "done",
            liked: false,
            user_liked: false
        })
        .select("id, content, created_at")
        .maybeSingle();
    if (!inserted.error) return inserted.data;
    if (inserted.error.code !== "23505") throw inserted.error;

    const existing = await database
        .from("moments")
        .select("id, content, created_at")
        .eq("id", id)
        .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) throw inserted.error;
    return existing.data;
}

async function handleTenantMomentPost({
    job,
    database,
    lease,
    getSettings,
    loadChatContext,
    generateReply,
    now = () => new Date(),
    random = Math.random
}) {
    if (job?.job_type !== "moment_post" || !job?.id) {
        throw new TypeError(
            "The handler only accepts identified moment_post jobs."
        );
    }
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    if (!lease || typeof lease.assertOwned !== "function") {
        throw new TypeError("An owned background-job lease is required.");
    }
    for (const [name, dependency] of Object.entries({
        getSettings,
        loadChatContext,
        generateReply
    })) {
        if (typeof dependency !== "function") {
            throw new TypeError(`${name} must be a function.`);
        }
    }

    const existing = await savedMomentForJob(database, job.id);
    if (existing) {
        const nextCheckMinutes = randomInteger(
            60,
            MAX_SEED_DELAY_MINUTES,
            random
        );
        await lease.assertOwned();
        await scheduleMomentPostEvaluation({
            database,
            predecessorJobId: job.id,
            delayMinutes: nextCheckMinutes,
            now,
            random
        });
        return {
            status: "handled",
            decision: "recovered",
            momentId: existing.id,
            nextCheckMinutes
        };
    }

    const settings = await getSettings(database);
    const [conversation, momentContext] = await Promise.all([
        latestConversation(database),
        recentMomentContext(database, settings)
    ]);
    if (!conversation?.id) {
        return { status: "skipped", reason: "no_conversation" };
    }
    const context = await loadChatContext(
        conversation.id,
        settings,
        database
    );
    const generated = await generateReply({
        settings: {
            ...settings,
            temperature: Math.max(
                0.75,
                Number(settings.temperature || 0.8)
            ),
            max_tokens: Math.min(
                1100,
                Math.max(400, Number(settings.max_tokens || 700))
            )
        },
        messages: [
            ...(Array.isArray(context?.messages)
                ? context.messages
                : []),
            {
                role: "user",
                content: buildMomentPostDecisionPrompt({
                    now: new Date(now()),
                    timezone: settings.timezone
                })
            }
        ],
        memories: Array.isArray(context?.memories)
            ? context.memories
            : [],
        runtimeContext: momentContext,
        promptArchitecture: "moment-post-module",
        purpose: "moment_post"
    });
    const decision = parseMomentPostDecision(generated?.text, random);
    let saved = null;

    if (decision.post) {
        await lease.assertOwned();
        saved = await insertMomentForJob({
            database,
            jobId: job.id,
            content: decision.content,
            now
        });
    }

    await lease.assertOwned();
    await scheduleMomentPostEvaluation({
        database,
        predecessorJobId: job.id,
        delayMinutes: decision.nextCheckMinutes,
        now,
        random
    });

    return {
        status: "handled",
        decision: saved ? "posted" : "none",
        momentId: saved?.id || null,
        nextCheckMinutes: decision.nextCheckMinutes
    };
}

module.exports = {
    MAX_NEXT_CHECK_MINUTES,
    MIN_NEXT_CHECK_MINUTES,
    buildMomentPostDecisionPrompt,
    handleTenantMomentPost,
    parseMomentPostDecision,
    scheduleMomentPostEvaluation
};
