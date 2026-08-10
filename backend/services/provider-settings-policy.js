function cleanPin(value, maxLength) {
    return Array.from(String(value || "").trim())
        .slice(0, maxLength)
        .join("");
}

function applyProviderSettingPins(
    settings,
    env = process.env,
    normalizeApiUrl = (value) => String(value || "").trim()
) {
    const providerPin = cleanPin(env.AI_PROVIDER_PIN, 50);
    const apiUrlPin = cleanPin(env.AI_API_URL_PIN, 500);
    if (Boolean(providerPin) !== Boolean(apiUrlPin)) {
        const error = new Error(
            "AI_PROVIDER_PIN 与 AI_API_URL_PIN 必须同时配置或同时留空。"
        );
        error.status = 500;
        error.code = "PROVIDER_PIN_PAIR_REQUIRED";
        throw error;
    }
    const provider = providerPin || cleanPin(settings?.provider, 50) || "custom";
    const apiUrl = normalizeApiUrl(apiUrlPin || settings?.api_url || "");

    return {
        ...settings,
        provider,
        api_url: apiUrl
    };
}

function isProductionDeployment(env = process.env) {
    if (String(env.NODE_ENV || "").toLowerCase() === "production") return true;
    return [env.RENDER, env.VERCEL, env.RAILWAY_ENVIRONMENT].some(
        (value) => String(value || "").trim().length > 0
    );
}

function assertProviderSettingsUpdateAllowed(current, next, production) {
    if (!production) return;

    const providerChanged = String(next?.provider || "") !== String(current?.provider || "");
    const apiUrlChanged = String(next?.api_url || "") !== String(current?.api_url || "");
    if (!providerChanged && !apiUrlChanged) return;

    const error = new Error(
        "公开部署已锁定 API 供应商和地址；请通过部署环境变量 AI_PROVIDER_PIN 与 AI_API_URL_PIN 更换。"
    );
    error.status = 403;
    error.code = "PROVIDER_SETTINGS_LOCKED";
    throw error;
}

function providerSettingsForPersistence({
    stored,
    effective,
    requested,
    production
}) {
    assertProviderSettingsUpdateAllowed(effective, requested, production);
    if (!production) {
        return {
            provider: requested.provider,
            api_url: requested.api_url
        };
    }

    return {
        provider: stored.provider,
        api_url: stored.api_url
    };
}

module.exports = {
    applyProviderSettingPins,
    assertProviderSettingsUpdateAllowed,
    isProductionDeployment,
    providerSettingsForPersistence
};
