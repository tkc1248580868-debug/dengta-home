const { createHash } = require("node:crypto");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRIVATE_IMAGE_ATTACHMENTS = 4;
const MAX_PRIVATE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PRIVATE_IMAGE_BASE64_CHARS =
    Math.ceil(MAX_PRIVATE_IMAGE_BYTES / 3) * 4;
const PRIVATE_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
]);

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function interactionError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function sanitizeMomentAttachments(value) {
    if (!Array.isArray(value)) return [];

    const sanitized = [];
    for (const item of value.slice(0, 16)) {
        if (sanitized.length >= MAX_PRIVATE_IMAGE_ATTACHMENTS) break;
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        if (
            Object.keys(item).some(
                (key) => key !== "mimeType" && key !== "data"
            )
        ) {
            continue;
        }

        const mimeType = String(item.mimeType || "")
            .trim()
            .toLowerCase();
        if (!PRIVATE_IMAGE_MIME_TYPES.has(mimeType)) continue;
        if (typeof item.data !== "string") continue;

        const data = item.data.replace(/\s/g, "");
        if (
            !data ||
            data.length > MAX_PRIVATE_IMAGE_BASE64_CHARS ||
            data.length % 4 !== 0
        ) {
            continue;
        }

        const padding = data.endsWith("==")
            ? 2
            : data.endsWith("=")
              ? 1
              : 0;
        const byteSize = (data.length / 4) * 3 - padding;
        if (
            byteSize <= 0 ||
            byteSize > MAX_PRIVATE_IMAGE_BYTES
        ) {
            continue;
        }
        const decoded = Buffer.from(data, "base64");
        if (
            decoded.length !== byteSize ||
            decoded.toString("base64") !== data
        ) {
            continue;
        }

        sanitized.push({ mimeType, data });
    }
    return sanitized;
}

function parseMomentReactionOutput(text) {
    const source = String(text || "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");

    try {
        if (start < 0 || end <= start) {
            throw new Error("missing_json");
        }
        const parsed = JSON.parse(source.slice(start, end + 1));
        const liked = parsed.like === true;
        const comment = cleanText(parsed.comment, 500);
        return {
            liked,
            comment,
            decision:
                liked && comment
                    ? "both"
                    : liked
                      ? "like"
                      : comment
                        ? "comment"
                        : "none"
        };
    } catch {
        return {
            liked: false,
            comment: "",
            decision: "none"
        };
    }
}

function isoNow(now) {
    const value = typeof now === "function" ? now() : Date.now();
    return new Date(value).toISOString();
}

function stableCommentReplyId(momentId, commentId) {
    const bytes = createHash("sha256")
        .update(
            `dengta:tenant-moment-comment-reply:${momentId}:${commentId}`,
            "utf8"
        )
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
    ].join("-");
}

function buildMomentInteractionPrompt({ moment, comment, context }) {
    const background =
        typeof context === "string"
            ? cleanText(context, 6000)
            : cleanText(
                  context?.background ||
                      context?.prompt ||
                      context?.summary,
                  6000
              );
    return [
        background ? `【本轮相关背景】\n${background}` : "",
        `【当前朋友圈】\n${cleanText(moment?.content, 2000) || "（仅有图片）"}`,
        comment
            ? `【用户最新评论】\n${cleanText(comment.content, 1000)}`
            : "",
        "请按照当前人设、关系和真实意愿，决定是否对这条朋友圈点赞、评论、两者都做，或什么都不做。",
        "不强迫点赞，不强迫评论；没有想说的话时两项都不做是有效决定。",
        '严格输出一行 JSON：{"like":true或false,"comment":"不超过500字，可以为空"}。不要解释。'
    ]
        .filter(Boolean)
        .join("\n\n");
}

async function handleTenantMomentInteraction({
    job,
    database,
    generateReply,
    getSettings,
    loadContext,
    lease,
    now = Date.now
}) {
    if (job?.job_type !== "moment_interaction") {
        throw interactionError(
            "invalid_moment_interaction_job",
            "The handler only accepts moment_interaction jobs."
        );
    }
    const momentId = cleanText(job?.payload?.moment_id, 100);
    const commentId = cleanText(job?.payload?.comment_id, 100) || null;
    if (!UUID_PATTERN.test(momentId)) {
        throw interactionError(
            "invalid_moment_id",
            "The moment interaction job requires a valid moment_id."
        );
    }
    if (commentId && !UUID_PATTERN.test(commentId)) {
        throw interactionError(
            "invalid_comment_id",
            "The moment interaction job comment_id is invalid."
        );
    }
    if (!database || typeof database.from !== "function") {
        throw interactionError(
            "missing_scoped_database",
            "A tenant-scoped database is required."
        );
    }
    if (!lease || typeof lease.assertOwned !== "function") {
        throw interactionError(
            "missing_moment_interaction_lease",
            "An owned background-job lease is required."
        );
    }
    for (const [name, dependency] of Object.entries({
        generateReply,
        getSettings,
        loadContext
    })) {
        if (typeof dependency !== "function") {
            throw interactionError(
                "missing_moment_interaction_dependency",
                `${name} must be injected into the moment interaction handler.`
            );
        }
    }

    const momentResult = await database
        .from("moments")
        .select("*")
        .eq("id", momentId)
        .maybeSingle();
    if (momentResult.error) throw momentResult.error;
    if (!momentResult.data) {
        return {
            status: "skipped",
            reason: "moment_not_found",
            momentId,
            commentId
        };
    }

    let sourceComment = null;
    if (commentId) {
        const commentResult = await database
            .from("moment_comments")
            .select("*")
            .eq("id", commentId)
            .eq("moment_id", momentId)
            .maybeSingle();
        if (commentResult.error) throw commentResult.error;
        if (!commentResult.data) {
            return {
                status: "skipped",
                reason: "comment_not_found",
                momentId,
                commentId
            };
        }
        sourceComment = commentResult.data;
        if (sourceComment.reply_status !== "pending") {
            return {
                status: "skipped",
                reason: "already_handled",
                momentId,
                commentId
            };
        }
    } else if (momentResult.data.reply_status !== "pending") {
        return {
            status: "skipped",
            reason: "already_handled",
            momentId,
            commentId
        };
    }

    const settings = await getSettings(database);
    const context = await loadContext({
        database,
        settings,
        job,
        moment: momentResult.data,
        comment: sourceComment
    });
    const generated = await generateReply({
        settings,
        messages: [
            ...(Array.isArray(context?.messages)
                ? context.messages
                : []),
            {
                role: "user",
                content: buildMomentInteractionPrompt({
                    moment: momentResult.data,
                    comment: sourceComment,
                    context
                })
            }
        ],
        memories: Array.isArray(context?.memories)
            ? context.memories
            : [],
        runtimeContext:
            typeof context?.runtimeContext === "string"
                ? context.runtimeContext
                : "",
        attachments: sanitizeMomentAttachments(
            context?.attachments
        ),
        promptArchitecture: "moment-module",
        purpose: "moment_interaction"
    });
    const reaction = parseMomentReactionOutput(generated?.text);

    if (sourceComment) {
        if (reaction.liked) {
            await lease.assertOwned();
            const likeResult = await database
                .from("moments")
                .update({ liked: true })
                .eq("id", momentId)
                .select("id")
                .maybeSingle();
            if (likeResult.error) throw likeResult.error;
        }

        if (reaction.comment) {
            const replyId = stableCommentReplyId(momentId, commentId);
            await lease.assertOwned();
            const insertResult = await database
                .from("moment_comments")
                .insert({
                    id: replyId,
                    moment_id: momentId,
                    author: "assistant",
                    content: reaction.comment,
                    reply_due_at: null,
                    reply_status: "none"
                })
                .select("id")
                .maybeSingle();
            if (insertResult.error && insertResult.error.code !== "23505") {
                throw insertResult.error;
            }
            if (insertResult.error?.code === "23505") {
                const existingResult = await database
                    .from("moment_comments")
                    .select("id")
                    .eq("id", replyId)
                    .eq("moment_id", momentId)
                    .maybeSingle();
                if (existingResult.error) throw existingResult.error;
                if (!existingResult.data) throw insertResult.error;
            }
        }

        await lease.assertOwned();
        const sourceUpdate = await database
            .from("moment_comments")
            .update({ reply_status: "done" })
            .eq("id", commentId)
            .eq("moment_id", momentId)
            .eq("reply_status", "pending")
            .select("id")
            .maybeSingle();
        if (sourceUpdate.error) throw sourceUpdate.error;

        return {
            status: "handled",
            decision: reaction.decision,
            momentId,
            commentId,
            liked: reaction.liked,
            commented: Boolean(reaction.comment)
        };
    }

    await lease.assertOwned();
    const updateResult = await database
        .from("moments")
        .update({
            liked: reaction.liked,
            reply_content: reaction.comment || null,
            replied_at: isoNow(now),
            reply_status: "done"
        })
        .eq("id", momentId)
        .eq("reply_status", "pending")
        .select("id")
        .maybeSingle();
    if (updateResult.error) throw updateResult.error;

    return {
        status: "handled",
        decision: reaction.decision,
        momentId,
        commentId,
        liked: reaction.liked,
        commented: Boolean(reaction.comment)
    };
}

module.exports = {
    buildMomentInteractionPrompt,
    handleTenantMomentInteraction,
    parseMomentReactionOutput,
    sanitizeMomentAttachments,
    stableCommentReplyId
};
