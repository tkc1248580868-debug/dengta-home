const {
    handleTenantMomentInteraction
} = require("./tenant-moment-interaction");

const MOMENT_BUCKET = "moments";
const MAX_MOMENT_IMAGES = 4;
const MAX_MOMENT_IMAGE_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = Object.freeze({
    "image/jpeg": (buffer) =>
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff,
    "image/png": (buffer) =>
        buffer.length >= 8 &&
        buffer
            .subarray(0, 8)
            .equals(
                Buffer.from([
                    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
                ])
            ),
    "image/webp": (buffer) =>
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP",
    "image/gif": (buffer) =>
        buffer.length >= 6 &&
        ["GIF87a", "GIF89a"].includes(
            buffer.subarray(0, 6).toString("ascii")
        )
});

function cleanStoragePath(value) {
    const storagePath = String(value || "").trim();
    if (
        !storagePath ||
        storagePath.includes("\\") ||
        storagePath.startsWith("/") ||
        storagePath.split("/").some((part) => !part || part === "." || part === "..")
    ) {
        return "";
    }
    return storagePath;
}

function ownedMomentImageDescriptor(value, job) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const storagePath = cleanStoragePath(value.storage_path);
    const mimeType = String(value.mime_type || "")
        .trim()
        .toLowerCase();
    const byteSize = Math.max(0, Number(value.byte_size) || 0);
    const expectedPrefix = `${job.user_id}/${job.companion_id}/`;
    if (
        !storagePath.startsWith(expectedPrefix) ||
        typeof IMAGE_TYPES[mimeType] !== "function" ||
        byteSize > MAX_MOMENT_IMAGE_BYTES
    ) {
        return null;
    }
    return { storagePath, mimeType };
}

async function blobBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value && typeof value.arrayBuffer === "function") {
        return Buffer.from(await value.arrayBuffer());
    }
    return null;
}

async function loadMomentImageAttachments({ storage, job, moment }) {
    const descriptors = (Array.isArray(moment?.images) ? moment.images : [])
        .slice(0, MAX_MOMENT_IMAGES)
        .map((value) => ownedMomentImageDescriptor(value, job))
        .filter(Boolean);
    const attachments = [];

    for (const descriptor of descriptors) {
        const { data, error } = await storage
            .from(MOMENT_BUCKET)
            .download(descriptor.storagePath);
        if (error) throw error;
        if (
            Number(data?.size) > MAX_MOMENT_IMAGE_BYTES ||
            (data?.type &&
                String(data.type).toLowerCase() !== descriptor.mimeType)
        ) {
            continue;
        }
        const bytes = await blobBuffer(data);
        if (
            !bytes ||
            !bytes.length ||
            bytes.length > MAX_MOMENT_IMAGE_BYTES ||
            !IMAGE_TYPES[descriptor.mimeType](bytes)
        ) {
            continue;
        }
        attachments.push({
            mimeType: descriptor.mimeType,
            data: bytes.toString("base64")
        });
    }

    return attachments;
}

function hintedConversationId(moment) {
    const match = String(moment?.context_note || "")
        .trim()
        .match(/^active_session_id:([0-9a-f-]+)$/i);
    return match && UUID_PATTERN.test(match[1]) ? match[1] : "";
}

async function latestConversationId(database) {
    const { data, error } = await database
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return UUID_PATTERN.test(String(data?.id || "")) ? data.id : "";
}

function createTenantMomentContextLoader({
    storage,
    loadCompanionInteractionContext
} = {}) {
    if (!storage || typeof storage.from !== "function") {
        throw new TypeError("Moment context storage is required.");
    }
    if (typeof loadCompanionInteractionContext !== "function") {
        throw new TypeError(
            "loadCompanionInteractionContext must be a function."
        );
    }

    return async function loadTenantMomentContext({
        database,
        settings,
        job,
        moment
    }) {
        const conversationId =
            hintedConversationId(moment) ||
            (await latestConversationId(database));
        const [context, attachments] = await Promise.all([
            conversationId
                ? loadCompanionInteractionContext(
                      conversationId,
                      settings,
                      database
                  )
                : Promise.resolve({ messages: [], memories: [] }),
            loadMomentImageAttachments({ storage, job, moment })
        ]);
        return {
            messages: Array.isArray(context?.messages)
                ? context.messages
                : [],
            memories: Array.isArray(context?.memories)
                ? context.memories
                : [],
            attachments
        };
    };
}

function createTenantMomentInteractionHandler({
    storage,
    generateReply,
    getSettings,
    loadCompanionInteractionContext,
    handleInteraction = handleTenantMomentInteraction,
    now = Date.now
} = {}) {
    if (typeof handleInteraction !== "function") {
        throw new TypeError("handleInteraction must be a function.");
    }
    const loadContext = createTenantMomentContextLoader({
        storage,
        loadCompanionInteractionContext
    });
    return ({ job, database, lease }) =>
        handleInteraction({
            job,
            database,
            lease,
            generateReply,
            getSettings,
            loadContext,
            now
        });
}

module.exports = {
    MAX_MOMENT_IMAGE_BYTES,
    MAX_MOMENT_IMAGES,
    createTenantMomentContextLoader,
    createTenantMomentInteractionHandler,
    loadMomentImageAttachments
};
