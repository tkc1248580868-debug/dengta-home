const {
    applyProviderSettingPins,
    isProductionDeployment,
    providerSettingsForPersistence
} = require("./provider-settings-policy");
const {
    assertPromptFieldsDoNotContainSecrets
} = require("./prompt-security");
const { publicRuntimeSettings } = require("./ai-provider-center");
const {
    normalizeReasoningEffort,
    reasoningProtocolForProvider
} = require("./provider-reasoning-effort");

const DEFAULT_SETTINGS = Object.freeze({
    ai_name: "伴侣",
    system_prompt: "",
    additional_prompt: "",
    personality: "",
    prompt_mode: "unified",
    unified_system_prompt: "",
    user_details: "",
    intimate_expression_enabled: false,
    provider: "custom",
    api_url: "",
    model: "",
    reasoning_effort: "",
    temperature: 0.7,
    context_turns: 20,
    max_tokens: 2048,
    compression_threshold: 12000,
    compression_keep: 20,
    timezone: "Asia/Shanghai",
    push_enabled: false,
    max_push_per_day: 7
});

function cleanText(value, maxLength = 10000) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function toNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function normalizePromptMode(value, fallback = "legacy") {
    const normalized = String(value ?? fallback)
        .trim()
        .toLowerCase();
    if (["legacy", "unified"].includes(normalized)) return normalized;

    const error = new Error("prompt_mode 只能是 legacy 或 unified。");
    error.status = 400;
    error.code = "invalid_prompt_mode";
    throw error;
}

function cleanUnifiedSystemPrompt(value) {
    const normalized = String(value ?? "");
    if (Array.from(normalized).length > 30000) {
        const error = new Error(
            "unified_system_prompt 不能超过 30000 个字符。"
        );
        error.status = 400;
        error.code = "unified_system_prompt_too_long";
        throw error;
    }
    return normalized;
}

function cleanUserDetails(value) {
    const normalized = String(value ?? "");
    if (Array.from(normalized).length > 30000) {
        const error = new Error("user_details 不能超过 30000 个字符。");
        error.status = 400;
        error.code = "user_details_too_long";
        throw error;
    }
    return normalized;
}

function normalizeApiUrl(value, env = process.env) {
    const cleaned = cleanText(value, 500).replace(/\/+$/, "");
    if (!cleaned) return "";

    let parsed;
    try {
        parsed = new URL(cleaned);
    } catch {
        const error = new Error("API 地址格式不正确。");
        error.status = 400;
        error.code = "invalid_api_url";
        throw error;
    }

    const hostname = parsed.hostname.toLowerCase();
    const localDevelopmentHost = [
        "localhost",
        "127.0.0.1",
        "::1"
    ].includes(hostname);
    const privateIpv4 =
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        /^169\.254\./.test(hostname);

    if (parsed.username || parsed.password) {
        const error = new Error("API 地址不能包含用户名或密码。");
        error.status = 400;
        error.code = "api_url_contains_credentials";
        throw error;
    }

    if (
        parsed.protocol !== "https:" &&
        !(env.NODE_ENV !== "production" && localDevelopmentHost)
    ) {
        const error = new Error("API 地址必须使用 HTTPS。");
        error.status = 400;
        error.code = "api_url_requires_https";
        throw error;
    }

    if (
        env.NODE_ENV === "production" &&
        (localDevelopmentHost ||
            privateIpv4 ||
            hostname.endsWith(".local"))
    ) {
        const error = new Error(
            "公开部署时不能使用本机或内网 API 地址。"
        );
        error.status = 400;
        error.code = "api_url_private_network";
        throw error;
    }

    return cleaned;
}

function providerUrlNormalizer(env) {
    return (value) => normalizeApiUrl(value, env);
}

async function getStoredSettings(database) {
    const { data, error } = await database
        .from("settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    if (data) return data;

    const { data: created, error: createError } = await database
        .from("settings")
        .insert({ ...DEFAULT_SETTINGS })
        .select("*")
        .single();
    if (!createError) return created;

    if (String(createError.code || "") !== "23505") {
        throw createError;
    }
    const retry = await database
        .from("settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (retry.error) throw retry.error;
    if (!retry.data) throw createError;
    return retry.data;
}

async function getBaseSettings(database, env = process.env) {
    const stored = await getStoredSettings(database);
    return applyProviderSettingPins(
        stored,
        env,
        providerUrlNormalizer(env)
    );
}

function buildSettingsChanges(stored, body = {}, env = process.env) {
    const current = applyProviderSettingPins(
        stored,
        env,
        providerUrlNormalizer(env)
    );
    const has = (field) =>
        Object.prototype.hasOwnProperty.call(body, field);
    const requestedProviderSettings = {
        provider: has("provider")
            ? cleanText(body.provider, 50) || "custom"
            : current.provider,
        api_url: has("api_url")
            ? normalizeApiUrl(body.api_url, env)
            : current.api_url
    };
    const persistedProviderSettings = providerSettingsForPersistence({
        stored,
        effective: current,
        requested: requestedProviderSettings,
        production: isProductionDeployment(env)
    });
    const reasoningProtocol = reasoningProtocolForProvider(
        requestedProviderSettings.provider
    );
    const reasoningEffort = has("reasoning_effort")
        ? normalizeReasoningEffort(
              body.reasoning_effort,
              reasoningProtocol,
              { strict: true }
          )
        : normalizeReasoningEffort(
              current.reasoning_effort,
              reasoningProtocol
          );
    const changes = {
        ai_name: has("ai_name")
            ? cleanText(body.ai_name, 50) || current.ai_name
            : current.ai_name,
        system_prompt: has("system_prompt")
            ? cleanText(body.system_prompt, 12000)
            : cleanText(current.system_prompt, 12000),
        additional_prompt: has("additional_prompt")
            ? cleanText(body.additional_prompt, 8000)
            : cleanText(current.additional_prompt, 8000),
        personality: has("personality")
            ? cleanText(body.personality, 1000)
            : cleanText(current.personality, 1000),
        prompt_mode: has("prompt_mode")
            ? normalizePromptMode(body.prompt_mode)
            : normalizePromptMode(current.prompt_mode),
        unified_system_prompt: has("unified_system_prompt")
            ? cleanUnifiedSystemPrompt(body.unified_system_prompt)
            : cleanUnifiedSystemPrompt(current.unified_system_prompt),
        user_details: has("user_details")
            ? cleanUserDetails(body.user_details)
            : cleanUserDetails(current.user_details),
        intimate_expression_enabled: has(
            "intimate_expression_enabled"
        )
            ? body.intimate_expression_enabled === true
            : current.intimate_expression_enabled === true,
        provider: persistedProviderSettings.provider,
        api_url: persistedProviderSettings.api_url,
        model: has("model")
            ? cleanText(body.model, 120)
            : current.model,
        reasoning_effort: reasoningEffort,
        temperature: toNumber(
            body.temperature,
            current.temperature,
            0,
            2
        ),
        context_turns: Math.round(
            toNumber(body.context_turns, current.context_turns, 1, 200)
        ),
        max_tokens: Math.round(
            toNumber(body.max_tokens, current.max_tokens, 64, 200000)
        ),
        compression_threshold: Math.round(
            toNumber(
                body.compression_threshold,
                current.compression_threshold ?? 12000,
                1000,
                200000
            )
        ),
        compression_keep: Math.round(
            toNumber(
                body.compression_keep,
                current.compression_keep ?? 20,
                1,
                200
            )
        ),
        timezone:
            cleanText(body.timezone, 80) ||
            current.timezone ||
            "Asia/Shanghai",
        push_enabled: has("push_enabled")
            ? body.push_enabled === true
            : current.push_enabled === true,
        max_push_per_day: Math.round(
            toNumber(
                body.max_push_per_day,
                current.max_push_per_day ?? 7,
                0,
                50
            )
        ),
        updated_at: new Date().toISOString()
    };
    assertPromptFieldsDoNotContainSecrets(changes);
    return changes;
}

async function updateStoredSettings(
    database,
    body = {},
    env = process.env
) {
    const stored = await getStoredSettings(database);
    const changes = buildSettingsChanges(stored, body, env);
    const { data, error } = await database
        .from("settings")
        .update(changes)
        .eq("id", stored.id)
        .select("*")
        .single();
    if (error) throw error;
    return applyProviderSettingPins(
        data,
        env,
        providerUrlNormalizer(env)
    );
}

async function publicStoredSettings(database, env = process.env) {
    return publicRuntimeSettings(await getBaseSettings(database, env));
}

module.exports = {
    DEFAULT_SETTINGS,
    buildSettingsChanges,
    cleanUserDetails,
    cleanUnifiedSystemPrompt,
    getBaseSettings,
    getStoredSettings,
    normalizeApiUrl,
    normalizePromptMode,
    publicStoredSettings,
    toNumber,
    updateStoredSettings
};
