const {
    createHash,
    createHmac,
    timingSafeEqual
} = require("crypto");
const {
    isSafeSpeechMessageId
} = require("./expressive-speech");

const TOKEN_PREFIX = "v1";
const TOKEN_CONTEXT = "dengta-home:expressive-speech-access:v1";
const DEFAULT_TOKEN_TTL_SECONDS = 10 * 60;
const DEFAULT_CACHE_MAX_ENTRIES = 24;
const DEFAULT_CACHE_MAX_BYTES = 24 * 1024 * 1024;

function boundedInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function signingSecret(env = process.env) {
    return String(
        env.EXPRESSIVE_TTS_ACCESS_SECRET ||
            env.SUPABASE_SECRET_KEY ||
            env.MINIMAX_API_KEY ||
            ""
    ).trim();
}

function derivedSigningKey(env = process.env) {
    const secret = signingSecret(env);
    if (!secret) return null;
    return createHash("sha256")
        .update(TOKEN_CONTEXT)
        .update("\0")
        .update(secret)
        .digest();
}

function isSafeConversationId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || "").trim()
    );
}

function tokenTtlSeconds(env = process.env) {
    return boundedInteger(
        env.EXPRESSIVE_TTS_TOKEN_TTL_SECONDS,
        DEFAULT_TOKEN_TTL_SECONDS,
        60,
        60 * 60
    );
}

function tokenDigest(
    messageId,
    conversationId,
    expiresAt,
    env = process.env
) {
    const key = derivedSigningKey(env);
    if (
        !key ||
        !isSafeSpeechMessageId(messageId) ||
        !isSafeConversationId(conversationId) ||
        !Number.isSafeInteger(expiresAt) ||
        expiresAt <= 0
    ) {
        return "";
    }
    return createHmac("sha256", key)
        .update(TOKEN_CONTEXT)
        .update("\0")
        .update(String(messageId))
        .update("\0")
        .update(String(conversationId).toLowerCase())
        .update("\0")
        .update(String(expiresAt))
        .digest("base64url");
}

function issueSpeechAccessToken(
    messageId,
    conversationId,
    env = process.env,
    now = Date.now()
) {
    const expiresAt =
        Math.floor(Number(now) / 1000) + tokenTtlSeconds(env);
    const digest = tokenDigest(
        messageId,
        conversationId,
        expiresAt,
        env
    );
    return digest
        ? `${TOKEN_PREFIX}.${expiresAt}.${digest}`
        : "";
}

function verifySpeechAccessToken(
    messageId,
    conversationId,
    token,
    env = process.env,
    now = Date.now()
) {
    const provided = String(token || "").trim();
    const match = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(
        provided
    );
    if (!match) return false;
    const expiresAt = Number(match[1]);
    const nowSeconds = Math.floor(Number(now) / 1000);
    const ttl = tokenTtlSeconds(env);
    if (
        !Number.isSafeInteger(expiresAt) ||
        !Number.isSafeInteger(nowSeconds) ||
        expiresAt < nowSeconds ||
        expiresAt > nowSeconds + ttl
    ) {
        return false;
    }
    const digest = tokenDigest(
        messageId,
        conversationId,
        expiresAt,
        env
    );
    const expected = digest
        ? `${TOKEN_PREFIX}.${expiresAt}.${digest}`
        : "";
    if (!expected || expected.length !== provided.length) return false;
    return timingSafeEqual(
        Buffer.from(expected, "utf8"),
        Buffer.from(provided, "utf8")
    );
}

function publicAssistantMessageWithSpeechAccess(
    publicMessage,
    conversationId,
    env = process.env,
    now = Date.now()
) {
    if (
        !publicMessage ||
        publicMessage.role !== "assistant" ||
        !isSafeSpeechMessageId(publicMessage.id) ||
        !isSafeConversationId(conversationId)
    ) {
        return publicMessage;
    }
    const speechToken = issueSpeechAccessToken(
        publicMessage.id,
        conversationId,
        env,
        now
    );
    return speechToken
        ? { ...publicMessage, speech_token: speechToken }
        : publicMessage;
}

function speechCacheOptions(env = process.env) {
    return {
        maxEntries: boundedInteger(
            env.EXPRESSIVE_TTS_CACHE_MAX_ENTRIES,
            DEFAULT_CACHE_MAX_ENTRIES,
            1,
            100
        ),
        maxBytes: boundedInteger(
            env.EXPRESSIVE_TTS_CACHE_MAX_BYTES,
            DEFAULT_CACHE_MAX_BYTES,
            1024 * 1024,
            128 * 1024 * 1024
        )
    };
}

function createExpressiveSpeechCache(options = {}) {
    const maxEntries = boundedInteger(
        options.maxEntries,
        DEFAULT_CACHE_MAX_ENTRIES,
        1,
        100
    );
    const maxBytes = boundedInteger(
        options.maxBytes,
        DEFAULT_CACHE_MAX_BYTES,
        1024,
        128 * 1024 * 1024
    );
    const entries = new Map();
    const inFlight = new Map();
    let totalBytes = 0;

    function get(key) {
        const normalizedKey = String(key || "");
        const cached = entries.get(normalizedKey);
        if (!cached) return null;
        entries.delete(normalizedKey);
        entries.set(normalizedKey, cached);
        return cached;
    }

    function set(key, speech) {
        const normalizedKey = String(key || "");
        if (
            !normalizedKey ||
            !Buffer.isBuffer(speech?.audio) ||
            speech.audio.length === 0 ||
            speech.audio.length > maxBytes
        ) {
            return false;
        }
        const existing = entries.get(normalizedKey);
        if (existing) {
            totalBytes -= existing.audio.length;
            entries.delete(normalizedKey);
        }
        const cached = {
            ...speech,
            audio: Buffer.from(speech.audio)
        };
        entries.set(normalizedKey, cached);
        totalBytes += cached.audio.length;

        while (
            entries.size > maxEntries ||
            totalBytes > maxBytes
        ) {
            const oldestKey = entries.keys().next().value;
            const oldest = entries.get(oldestKey);
            entries.delete(oldestKey);
            totalBytes -= oldest?.audio?.length || 0;
        }
        return entries.has(normalizedKey);
    }

    async function getOrCreate(key, create) {
        const cached = get(key);
        if (cached) return { speech: cached, cacheStatus: "hit" };

        const normalizedKey = String(key || "");
        const pending = inFlight.get(normalizedKey);
        if (pending) {
            return {
                speech: await pending,
                cacheStatus: "shared"
            };
        }

        const task = Promise.resolve().then(create);
        inFlight.set(normalizedKey, task);
        try {
            const speech = await task;
            set(normalizedKey, speech);
            return { speech, cacheStatus: "miss" };
        } finally {
            if (inFlight.get(normalizedKey) === task) {
                inFlight.delete(normalizedKey);
            }
        }
    }

    function stats() {
        return {
            entries: entries.size,
            bytes: totalBytes,
            in_flight: inFlight.size,
            max_entries: maxEntries,
            max_bytes: maxBytes
        };
    }

    return { get, getOrCreate, set, stats };
}

module.exports = {
    DEFAULT_CACHE_MAX_BYTES,
    DEFAULT_CACHE_MAX_ENTRIES,
    DEFAULT_TOKEN_TTL_SECONDS,
    TOKEN_CONTEXT,
    createExpressiveSpeechCache,
    isSafeConversationId,
    issueSpeechAccessToken,
    publicAssistantMessageWithSpeechAccess,
    speechCacheOptions,
    tokenTtlSeconds,
    verifySpeechAccessToken
};
