const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    decryptScopedSecret,
    encryptScopedSecret,
    fetchGeneratedImage,
    normalizeCreativeSettings,
    normalizeIdea,
    publicCreativeError,
    sanitizeUploadedImage
} = require("../services/companion-creative");
const {
    buildCreativeDecisionPrompt,
    parseCreativeDecision
} = require("../services/tenant-companion-creative");
const { publicMessage } = require("../services/chat-attachments");

(async () => {
const userId = "11111111-1111-4111-8111-111111111111";
const companionId = "22222222-2222-4222-8222-222222222222";
const otherCompanionId = "33333333-3333-4333-8333-333333333333";
const identity = { userId, companionId };
const env = {
    MCP_ENCRYPTION_KEY:
        "creative-test-encryption-key-which-is-long-enough-2026"
};

assert.deepEqual(
    normalizeCreativeSettings({
        generation_mode: "autonomous",
        daily_call_limit: "",
        monthly_call_limit: 120,
        surprise_enabled: true,
        max_surprise_days: 365
    }),
    {
        generation_mode: "autonomous",
        daily_call_limit: null,
        monthly_call_limit: 120,
        surprise_enabled: true,
        max_surprise_days: 365
    }
);
assert.equal(
    normalizeCreativeSettings({
        generation_mode: "confirm",
        surprise_enabled: true
    }).surprise_enabled,
    false,
    "secret surprises must stay off outside autonomous mode"
);
assert.throws(
    () =>
        normalizeCreativeSettings({
            generation_mode: "autonomous",
            daily_call_limit: -1
        }),
    /调用上限/
);

const encrypted = encryptScopedSecret(
    "image-key-secret",
    identity,
    "image-provider",
    env
);
assert.doesNotMatch(encrypted, /image-key-secret/);
assert.equal(
    decryptScopedSecret(
        encrypted,
        identity,
        "image-provider",
        env
    ),
    "image-key-secret"
);
assert.throws(
    () =>
        decryptScopedSecret(
            encrypted,
            { userId, companionId: otherCompanionId },
            "image-provider",
            env
        ),
    /当前账号不匹配/
);

assert.deepEqual(
    normalizeIdea({
        kind: "gift",
        idea: "把雨夜聊天画成一盏暖灯。",
        prompt: "A warm lamp beside a rainy window, soft illustration",
        surprise: true,
        reveal_after_minutes: 9999999
    }),
    {
        kind: "gift",
        title: "一张没有命名的画",
        description: "把雨夜聊天画成一盏暖灯。",
        prompt: "A warm lamp beside a rainy window, soft illustration",
        reason: "想把这一刻留下来。",
        alt_text: "AI 伴侣创作的图片",
        surprise: true,
        reveal_after_minutes: 525600
    }
);

const decision = parseCreativeDecision(
    JSON.stringify({
        create: true,
        kind: "doodle",
        title: "雨窗",
        description: "来自真实聊天的雨夜构思",
        prompt: "rainy window, warm lamp",
        reason: "刚才聊到了下雨",
        alt_text: "雨窗边的一盏暖灯",
        surprise: true,
        reveal_after_minutes: 200000,
        next_check_minutes: 0
    }),
    {
        allowSurprise: true,
        maxSurpriseDays: 30,
        random: () => 0
    }
);
assert.equal(decision.create, true);
assert.equal(decision.surprise, true);
assert.equal(decision.reveal_after_minutes, 30 * 24 * 60);
assert.equal(decision.next_check_minutes, 60);
assert.equal(
    parseCreativeDecision("{\"create\":true}", {
        allowSurprise: true
    }).create,
    false,
    "incomplete image prompts must never trigger a provider call"
);

const prompt = buildCreativeDecisionPrompt({
    messages: [
        {
            role: "user",
            content: "今天下雨了",
            created_at: "2026-07-28T10:00:00.000Z"
        },
        {
            role: "assistant",
            content: "我想陪你听雨",
            created_at: "2026-07-28T10:00:02.000Z"
        }
    ],
    latestProfile: { introduction: "喜欢温暖的灯光" },
    allowSurprise: false
});
assert.match(prompt, /沿用个性化指令决定的叙事世界和人物关系/);
assert.doesNotMatch(prompt, /不得虚构共同经历/);
assert.match(prompt, /surprise 必须为 false/);
assert.match(prompt, /今天下雨了/);

const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
);
const sanitizedUpload = sanitizeUploadedImage(
    onePixelPng,
    "image/png"
);
assert.equal(sanitizedUpload.mimeType, "image/png");
assert.equal(sanitizedUpload.extension, "png");
assert.deepEqual(sanitizedUpload.bytes, onePixelPng);
const privateText = Buffer.from("Comment\0private-location-note", "latin1");
const textChunk = Buffer.alloc(12 + privateText.length);
textChunk.writeUInt32BE(privateText.length, 0);
textChunk.write("tEXt", 4, "ascii");
privateText.copy(textChunk, 8);
const pngWithMetadata = Buffer.concat([
    onePixelPng.subarray(0, -12),
    textChunk,
    onePixelPng.subarray(-12)
]);
const sanitizedMetadataUpload = sanitizeUploadedImage(
    pngWithMetadata,
    "image/png"
);
assert.equal(
    sanitizedMetadataUpload.bytes.includes(Buffer.from("tEXt")),
    false
);
assert.equal(
    sanitizedMetadataUpload.bytes.includes(Buffer.from("private-location-note")),
    false
);
assert.throws(
    () =>
        sanitizeUploadedImage(
            Buffer.concat([onePixelPng, Buffer.from([0])]),
            "image/png"
        ),
    /结构不完整或已经损坏/
);
let providerRequest;
const generated = await fetchGeneratedImage({
    provider: {
        base_url: "https://images.example.test/v1",
        auth_type: "bearer",
        model: "test-image"
    },
    credential: "hidden-key",
    production: false,
    fetchImpl: async (url, options) => {
        providerRequest = { url, options };
        return new Response(
            JSON.stringify({
                data: [{ b64_json: onePixelPng.toString("base64") }]
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
});
assert.equal(providerRequest.url, "https://images.example.test/v1/images/generations");
assert.equal(providerRequest.options.headers.Authorization, "Bearer hidden-key");
assert.equal(JSON.parse(providerRequest.options.body).response_format, "b64_json");
assert.equal(generated.mimeType, "image/png");
assert.deepEqual(generated.bytes, onePixelPng);

const compatibilityRequests = [];
const compatibilityFallback = await fetchGeneratedImage({
    provider: {
        base_url: "https://images.example.test/v1",
        auth_type: "bearer",
        model: "test-image"
    },
    credential: "hidden-key",
    production: false,
    fetchImpl: async (_url, options) => {
        compatibilityRequests.push(JSON.parse(options.body));
        if (compatibilityRequests.length === 1) {
            return new Response(
                JSON.stringify({
                    error: { message: "Unknown field: response_format" }
                }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }
        return new Response(
            JSON.stringify({
                data: [{ b64_json: onePixelPng.toString("base64") }]
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
});
assert.equal(compatibilityRequests.length, 2);
assert.equal(compatibilityRequests[0].response_format, "b64_json");
assert.equal(
    Object.hasOwn(compatibilityRequests[1], "response_format"),
    false
);
assert.deepEqual(compatibilityFallback.bytes, onePixelPng);

for (const payload of [
    {
        output: [
            {
                type: "image_generation_call",
                result: onePixelPng.toString("base64")
            }
        ]
    },
    {
        images: [
            {
                b64_json: onePixelPng.toString("base64")
            }
        ]
    }
]) {
    const compatible = await fetchGeneratedImage({
        provider: {
            base_url: "https://images.example.test/v1",
            auth_type: "bearer",
            model: "test-image"
        },
        credential: "hidden-key",
        production: false,
        fetchImpl: async () =>
            new Response(JSON.stringify(payload), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            })
    });
    assert.equal(compatible.mimeType, "image/png");
    assert.deepEqual(compatible.bytes, onePixelPng);
}

const directBinary = await fetchGeneratedImage({
    provider: {
        base_url: "https://images.example.test/v1",
        auth_type: "bearer",
        model: "test-image"
    },
    credential: "hidden-key",
    production: false,
    fetchImpl: async () =>
        new Response(onePixelPng, {
            status: 200,
            headers: { "Content-Type": "image/png" }
        })
});
assert.equal(directBinary.mimeType, "image/png");
assert.deepEqual(directBinary.bytes, onePixelPng);

const rejected = publicCreativeError(
    Object.assign(new Error("private upstream detail"), {
        upstream_status: 401
    })
);
assert.equal(rejected.code, "creative_request_failed");
assert.doesNotMatch(rejected.message, /private upstream detail/);

const artworkId = "44444444-4444-4444-8444-444444444444";
const visibleMessage = publicMessage({
    id: 1,
    role: "assistant",
    content: "给你",
    created_at: "2026-07-28T10:00:00.000Z",
    tool_calls: {
        artwork_id: artworkId,
        artwork_alt: "一盏暖灯",
        is_surprise_reveal: true,
        artwork_storage_path: "../../private",
        image_provider_key: "secret"
    }
});
assert.deepEqual(visibleMessage.tool_calls, {
    artwork_id: artworkId,
    artwork_alt: "一盏暖灯",
    is_surprise_reveal: true
});

const migration = fs.readFileSync(
    path.join(
        __dirname,
        "..",
        "supabase",
        "018_companion_creative_studio.sql"
    ),
    "utf8"
);
for (const marker of [
    "companion_creative_settings",
    "image_provider_profiles",
    "companion_artworks",
    "image_generation_calls",
    "'creative_check'",
    "'surprise_reveal'",
    "'companion-artworks'"
]) {
    assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(migration, /revoke all[\s\S]*authenticated/i);

const runtimeSource = fs.readFileSync(
    path.join(
        __dirname,
        "..",
        "services",
        "tenant-companion-creative.js"
    ),
    "utf8"
);
assert.match(runtimeSource, /async function publishArtworkMessage/);
assert.match(
    runtimeSource,
    /artwork\.visibility === "ordinary"[\s\S]*?publishArtworkMessage/
);
assert.match(
    runtimeSource,
    /is_push:\s*true[\s\S]*?is_companion_creative:\s*true/
);
assert.match(
    runtimeSource,
    /surpriseReveal[\s\S]*?is_surprise_reveal:\s*true/
);

console.log("companion creative studio tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
