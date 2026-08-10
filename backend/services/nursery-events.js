const { stableUuid } = require("./tenant-proactive-message");
const { applyNurseryAction } = require("./nursery");

const FIRST_EVENT_MIN_HOURS = 6;
const FIRST_EVENT_SPREAD_HOURS = 6;
const NEXT_EVENT_MIN_HOURS = 18;
const NEXT_EVENT_SPREAD_HOURS = 12;
const EVENT_EXPIRY_MINUTES = 45;

function deterministicNumber(value) {
    return parseInt(
        stableUuid("nursery-event-seed", value).replace(/-/g, "").slice(0, 8),
        16
    );
}

function nurseryEventTimes({ childId, sourceKey, now = new Date() }) {
    const current = new Date(now);
    const first = sourceKey === "birth";
    const minimumHours = first
        ? FIRST_EVENT_MIN_HOURS
        : NEXT_EVENT_MIN_HOURS;
    const spreadHours = first
        ? FIRST_EVENT_SPREAD_HOURS
        : NEXT_EVENT_SPREAD_HOURS;
    const offsetMinutes =
        minimumHours * 60 +
        (deterministicNumber(`${childId}:${sourceKey}`) %
            Math.max(1, spreadHours * 60));
    const dueAt = new Date(current.getTime() + offsetMinutes * 60 * 1000);
    return {
        dueAt,
        expiresAt: new Date(
            dueAt.getTime() + EVENT_EXPIRY_MINUTES * 60 * 1000
        )
    };
}

async function findEvent(database, eventId) {
    const result = await database
        .from("nursery_events")
        .select(
            "id, child_id, kind, due_at, expires_at, status, payload, created_at, fired_at"
        )
        .eq("id", eventId)
        .maybeSingle();
    if (result.error) throw result.error;
    return result.data || null;
}

async function scheduleNextNurseryEvent({
    database,
    childId,
    sourceKey = "birth",
    now = () => new Date()
}) {
    const timestamp = now();
    const dedupeKey = `nursery-event:${childId}:${sourceKey}`;
    const eventId = stableUuid("nursery-event", dedupeKey);
    const existing = await findEvent(database, eventId);
    let inserted = { data: null, error: null };
    let event = existing;
    if (!event) {
        const { dueAt, expiresAt } = nurseryEventTimes({
            childId,
            sourceKey,
            now: timestamp
        });
        inserted = await database
            .from("nursery_events")
            .insert({
                id: eventId,
                child_id: childId,
                kind: "night_cry",
                due_at: dueAt.toISOString(),
                expires_at: expiresAt.toISOString(),
                status: "pending",
                payload: { source_key: sourceKey },
                dedupe_key: dedupeKey
            })
            .select(
                "id, child_id, kind, due_at, expires_at, status, payload, created_at, fired_at"
            )
            .maybeSingle();
        if (inserted.error && inserted.error.code !== "23505") {
            throw inserted.error;
        }
        event = inserted.data || (await findEvent(database, eventId));
    }
    if (!event) throw inserted.error || new Error("Nursery event was not saved.");

    const job = await database.from("background_jobs").insert({
        id: stableUuid("nursery-event-job", eventId),
        job_type: "nursery_event",
        due_at: event.due_at,
        dedupe_key: `nursery-event-job:${eventId}`,
        status: "pending",
        payload: {
            event_id: eventId,
            child_id: childId
        }
    });
    if (job.error && job.error.code !== "23505") throw job.error;
    return {
        scheduled: Boolean(inserted.data),
        reason: inserted.data ? "scheduled" : "already_scheduled",
        event
    };
}

async function findNurseryPushMessage(database, jobId) {
    const result = await database
        .from("messages")
        .select("id, conversation_id, content, created_at")
        .eq("role", "assistant")
        .contains("tool_calls", {
            is_nursery_event: true,
            source_background_job_id: jobId
        })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (result.error) throw result.error;
    return result.data || null;
}

async function ensureNurseryPushMessage({
    database,
    job,
    event,
    childName,
    utterance,
    saveMessage,
    touchConversation
}) {
    const existing = await findNurseryPushMessage(database, job.id);
    if (existing) return existing;
    const conversation = await database
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (conversation.error) throw conversation.error;
    if (!conversation.data?.id) return null;
    const name = childName || "小朋友";
    const content = `${name}醒了，正哭着找我们。${utterance ? `她小声说：“${utterance}”` : ""}`;
    const saved = await saveMessage(
        conversation.data.id,
        "assistant",
        content,
        {
            database,
            tool_calls: {
                is_push: true,
                is_nursery_event: true,
                nursery_event_id: event.id,
                source_background_job_id: job.id,
                response_mode: "local_nursery_event"
            }
        }
    );
    await touchConversation(conversation.data.id, database);
    return saved;
}

async function handleNurseryEvent({
    job,
    database,
    lease,
    saveMessage,
    touchConversation,
    now = () => new Date()
}) {
    if (job?.job_type !== "nursery_event" || !job?.id) {
        throw new TypeError("The handler only accepts nursery_event jobs.");
    }
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    if (!lease || typeof lease.assertOwned !== "function") {
        throw new TypeError("An owned background-job lease is required.");
    }
    if (
        typeof saveMessage !== "function" ||
        typeof touchConversation !== "function"
    ) {
        throw new TypeError("Nursery event message services are required.");
    }
    const eventId = String(job.payload?.event_id || "").trim();
    const event = await findEvent(database, eventId);
    if (!event) return { status: "missing" };
    const timestamp = now();
    if (
        event.status === "pending" &&
        Date.parse(event.expires_at) <= timestamp.getTime()
    ) {
        await lease.assertOwned();
        const expired = await database
            .from("nursery_events")
            .update({ status: "expired" })
            .eq("id", event.id)
            .eq("status", "pending");
        if (expired.error) throw expired.error;
        await scheduleNextNurseryEvent({
            database,
            childId: event.child_id,
            sourceKey: `job:${job.id}`,
            now
        });
        return { status: "expired" };
    }

    let childName = event.payload?.child_name || null;
    let utterance = event.payload?.utterance || "";
    if (event.status === "pending") {
        await lease.assertOwned();
        const applied = await applyNurseryAction({
            database,
            childId: event.child_id,
            actor: "system",
            action: "event",
            clientActionId: job.id,
            now
        });
        childName = applied.child?.name || null;
        utterance = applied.child_utterance?.text || "";
        await lease.assertOwned();
        const fired = await database
            .from("nursery_events")
            .update({
                status: "fired",
                fired_at: timestamp.toISOString(),
                payload: {
                    ...(event.payload || {}),
                    child_name: childName,
                    utterance
                }
            })
            .eq("id", event.id)
            .eq("status", "pending");
        if (fired.error) throw fired.error;
    } else if (event.status === "expired") {
        await lease.assertOwned();
        await scheduleNextNurseryEvent({
            database,
            childId: event.child_id,
            sourceKey: `job:${job.id}`,
            now
        });
        return { status: "expired" };
    } else if (event.status !== "fired") {
        return { status: event.status };
    }

    await lease.assertOwned();
    const message = await ensureNurseryPushMessage({
        database,
        job,
        event,
        childName,
        utterance,
        saveMessage,
        touchConversation
    });
    await lease.assertOwned();
    await scheduleNextNurseryEvent({
        database,
        childId: event.child_id,
        sourceKey: `job:${job.id}`,
        now
    });
    return {
        status: "fired",
        eventId: event.id,
        messageId: message?.id || null
    };
}

module.exports = {
    EVENT_EXPIRY_MINUTES,
    handleNurseryEvent,
    nurseryEventTimes,
    scheduleNextNurseryEvent
};
