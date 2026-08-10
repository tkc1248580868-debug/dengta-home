const assert = require("node:assert/strict");
const {
    applyProviderSettingPins,
    assertProviderSettingsUpdateAllowed,
    isProductionDeployment,
    providerSettingsForPersistence
} = require("../services/provider-settings-policy");

function normalizeApiUrl(value) {
    const cleaned = String(value || "").trim().replace(/\/+$/, "");
    if (cleaned && !cleaned.startsWith("https://")) {
        throw new Error("invalid test API URL");
    }
    return cleaned;
}

const stored = {
    id: "settings-id",
    provider: "custom",
    api_url: "https://provider.example/v1/",
    model: "model-a"
};

const unpinned = applyProviderSettingPins(stored, {}, normalizeApiUrl);
assert.equal(unpinned.provider, "custom");
assert.equal(unpinned.api_url, "https://provider.example/v1");

const pinned = applyProviderSettingPins(
    stored,
    {
        AI_PROVIDER_PIN: "openai-compatible",
        AI_API_URL_PIN: "https://pinned.example/v1/"
    },
    normalizeApiUrl
);
assert.equal(pinned.provider, "openai-compatible");
assert.equal(pinned.api_url, "https://pinned.example/v1");
assert.equal(pinned.model, "model-a");
for (const incompletePins of [
    { AI_PROVIDER_PIN: "anthropic" },
    { AI_API_URL_PIN: "https://pinned.example/v1" }
]) {
    assert.throws(
        () => applyProviderSettingPins(stored, incompletePins, normalizeApiUrl),
        (error) =>
            error.status === 500 &&
            error.code === "PROVIDER_PIN_PAIR_REQUIRED"
    );
}

const serverSource = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "server.js"),
    "utf8"
);
assert.match(
    serverSource,
    /app\.get\("\/health"[\s\S]*?applyProviderSettingPins\(\{\}, process\.env, normalizeApiUrl\)/,
    "健康检查必须验证固定供应商与接口地址是否成对配置"
);
assert.match(
    serverSource,
    /res\.status\(providerConfigurationError \? 503 : 200\)/,
    "固定接口配置不完整时健康检查必须返回 503"
);
assert.equal(isProductionDeployment({ NODE_ENV: "production" }), true);
assert.equal(isProductionDeployment({ RENDER: "true" }), true);
assert.equal(isProductionDeployment({ VERCEL: "1" }), true);
assert.equal(isProductionDeployment({ NODE_ENV: "development" }), false);

assert.doesNotThrow(() =>
    assertProviderSettingsUpdateAllowed(
        unpinned,
        { ...unpinned },
        true
    )
);

assert.deepEqual(
    providerSettingsForPersistence({
        stored,
        effective: pinned,
        requested: {
            provider: pinned.provider,
            api_url: pinned.api_url
        },
        production: true
    }),
    {
        provider: stored.provider,
        api_url: stored.api_url
    }
);

assert.deepEqual(
    providerSettingsForPersistence({
        stored,
        effective: unpinned,
        requested: {
            provider: "anthropic",
            api_url: "https://local-test.example/v1"
        },
        production: false
    }),
    {
        provider: "anthropic",
        api_url: "https://local-test.example/v1"
    }
);

for (const changed of [
    { ...unpinned, provider: "anthropic" },
    { ...unpinned, api_url: "https://attacker.example/v1" }
]) {
    assert.throws(
        () =>
            assertProviderSettingsUpdateAllowed(
                unpinned,
                changed,
                true
            ),
        (error) =>
            error.status === 403 && error.code === "PROVIDER_SETTINGS_LOCKED"
    );
}

assert.doesNotThrow(() =>
    assertProviderSettingsUpdateAllowed(
        unpinned,
        { ...unpinned, api_url: "https://local-test.example/v1" },
        false
    )
);

console.log("production provider settings pin and lock tests passed");
