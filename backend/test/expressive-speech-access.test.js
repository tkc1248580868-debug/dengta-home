const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createExpressiveSpeechCache,
    isSafeConversationId,
    issueSpeechAccessToken,
    publicAssistantMessageWithSpeechAccess,
    speechCacheOptions,
    tokenTtlSeconds,
    verifySpeechAccessToken
} = require("../services/expressive-speech-access");

const env = {
    SUPABASE_SECRET_KEY:
        "test-only-supabase-service-secret-with-enough-entropy",
    EXPRESSIVE_TTS_TOKEN_TTL_SECONDS: "600"
};
const conversationId = "11111111-1111-4111-8111-111111111111";
const now = Date.parse("2026-07-24T00:00:00.000Z");

const token = issueSpeechAccessToken("65", conversationId, env, now);
assert.match(token, /^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
assert.equal(
    verifySpeechAccessToken("65", conversationId, token, env, now),
    true
);
assert.equal(
    verifySpeechAccessToken("66", conversationId, token, env, now),
    false
);
assert.equal(
    verifySpeechAccessToken(
        "65",
        "22222222-2222-4222-8222-222222222222",
        token,
        env,
        now
    ),
    false
);
assert.equal(
    verifySpeechAccessToken(
        "65",
        conversationId,
        token,
        env,
        now + 601_000
    ),
    false
);
assert.equal(
    verifySpeechAccessToken(
        "65",
        conversationId,
        `${token}x`,
        env,
        now
    ),
    false
);
assert.equal(
    verifySpeechAccessToken(
        "65",
        conversationId,
        "v1.not-a-token",
        env,
        now
    ),
    false
);
assert.equal(
    issueSpeechAccessToken(
        "not-a-message",
        conversationId,
        env,
        now
    ),
    ""
);
assert.equal(
    issueSpeechAccessToken("65", conversationId, {}, now),
    ""
);
assert.equal(isSafeConversationId(conversationId), true);
assert.equal(isSafeConversationId("not-a-conversation"), false);
assert.equal(tokenTtlSeconds(env), 600);

const serverSource = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);
const publicMessageSource = fs.readFileSync(
    path.join(__dirname, "..", "services", "chat-attachments.js"),
    "utf8"
);
const speechRouteStart = serverSource.indexOf(
    'app.post("/voice/speech"'
);
const speechRouteEnd = serverSource.indexOf(
    'app.post("/chat"',
    speechRouteStart
);
const speechRoute = serverSource.slice(
    speechRouteStart,
    speechRouteEnd
);
assert.match(speechRoute, /verifySpeechAccessToken\(/);
assert.match(
    speechRoute,
    /\.eq\("conversation_id", conversationId\)/
);
assert.match(speechRoute, /expressiveSpeechCache\.getOrCreate\(/);
assert.ok(
    speechRoute.indexOf("verifySpeechAccessToken(") <
        speechRoute.indexOf(
            "expressiveSpeechRateLimitState.consume"
        ),
    "invalid capability requests must not consume the valid-user IP quota"
);
assert.doesNotMatch(
    publicMessageSource,
    /safeToolCalls\.speech_token|speech_token\s*:/
);
assert.ok(
    (
        serverSource.match(
            /assistant_message:\s*publicAssistantMessage\(/g
        ) || []
    ).length >= 4,
    "all live assistant response paths must issue a short-lived speech token"
);

const publicMessage = publicAssistantMessageWithSpeechAccess(
    {
        id: 65,
        role: "assistant",
        content: "你好"
    },
    conversationId,
    env,
    now
);
assert.equal(publicMessage.speech_token, token);
assert.equal(
    Object.hasOwn(
        publicAssistantMessageWithSpeechAccess(
            { id: 65, role: "user", content: "你好" },
            conversationId,
            env,
            now
        ),
        "speech_token"
    ),
    false
);

assert.deepEqual(
    speechCacheOptions({
        EXPRESSIVE_TTS_CACHE_MAX_ENTRIES: "8",
        EXPRESSIVE_TTS_CACHE_MAX_BYTES: String(4 * 1024 * 1024)
    }),
    {
        maxEntries: 8,
        maxBytes: 4 * 1024 * 1024
    }
);

async function run() {
    const cache = createExpressiveSpeechCache({
        maxEntries: 2,
        maxBytes: 1024
    });
    let creates = 0;
    const createSpeech = async () => {
        creates += 1;
        await Promise.resolve();
        return {
            audio: Buffer.from("audio"),
            contentType: "audio/mpeg",
            provider: "minimax",
            emotion: "calm"
        };
    };

    const [first, shared] = await Promise.all([
        cache.getOrCreate("65", createSpeech),
        cache.getOrCreate("65", createSpeech)
    ]);
    assert.equal(creates, 1);
    assert.equal(first.cacheStatus, "miss");
    assert.equal(shared.cacheStatus, "shared");

    const hit = await cache.getOrCreate("65", createSpeech);
    assert.equal(hit.cacheStatus, "hit");
    assert.equal(creates, 1);
    assert.deepEqual(hit.speech.audio, Buffer.from("audio"));

    cache.set("66", { ...hit.speech, audio: Buffer.from("six") });
    cache.set("67", { ...hit.speech, audio: Buffer.from("seven") });
    assert.equal(cache.get("65"), null);
    assert.equal(cache.stats().entries, 2);
    assert.equal(cache.stats().in_flight, 0);
}

run()
    .then(() => console.log("expressive speech access tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
