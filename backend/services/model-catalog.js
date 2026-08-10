const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const MODEL_LIST_TIMEOUT_MS = 15_000;

const modelCache = new Map();

function cleanUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function cleanModelId(value) {
    const model = String(value || "").trim();
    if (!model || model.length > 160 || /[\u0000-\u001f\u007f]/.test(model)) {
        return "";
    }
    return model;
}

function providerKey(provider, settings = {}) {
    if (typeof settings.runtime_api_key === "string") {
        return settings.runtime_api_key;
    }
    if (provider === "gemini") {
        return process.env.GEMINI_API_KEY || process.env.MAIN_MODEL_API_KEY || "";
    }
    if (provider === "anthropic") {
        return process.env.ANTHROPIC_API_KEY || process.env.MAIN_MODEL_API_KEY || "";
    }
    if (provider === "openai-compatible" || provider === "openai-responses") {
        return (
            process.env.OPENAI_COMPATIBLE_API_KEY ||
            process.env.MAIN_MODEL_API_KEY ||
            ""
        );
    }
    return process.env.CUSTOM_API_KEY || process.env.MAIN_MODEL_API_KEY || "";
}

function openAiModelsEndpoint(apiUrl) {
    const base = cleanUrl(apiUrl);
    if (!base) return "";
    if (/\/chat\/completions$/i.test(base)) {
        return base.replace(/\/chat\/completions$/i, "/models");
    }

    let parsed;
    try {
        parsed = new URL(base);
    } catch {
        return "";
    }
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") {
        parsed.pathname = "/v1/models";
        return parsed.toString().replace(/\/$/, "");
    }
    if (/\/v\d+(?:beta)?$/i.test(pathname)) {
        parsed.pathname = `${pathname}/models`;
        return parsed.toString().replace(/\/$/, "");
    }
    parsed.pathname = `${pathname}/models`;
    return parsed.toString().replace(/\/$/, "");
}

function anthropicModelsEndpoint(apiUrl) {
    const base = cleanUrl(apiUrl) || "https://api.anthropic.com/v1";
    if (/\/messages$/i.test(base)) {
        return base.replace(/\/messages$/i, "/models");
    }
    if (/\/models$/i.test(base)) return base;
    return `${base}/models`;
}

function geminiModelsEndpoint(apiUrl) {
    const base =
        cleanUrl(apiUrl) || "https://generativelanguage.googleapis.com/v1beta";
    let parsed;
    try {
        parsed = new URL(base);
    } catch {
        return "";
    }
    parsed.pathname = parsed.pathname
        .replace(/\/models\/[^/]+(?::(?:streamGenerateContent|generateContent))?$/i, "/models")
        .replace(/\/+$/, "");
    if (!/\/models$/i.test(parsed.pathname)) {
        parsed.pathname = `${parsed.pathname}/models`.replace(/\/+/g, "/");
    }
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
}

function cacheKey(settings) {
    return `${String(settings.provider || "custom").trim()}|${cleanUrl(
        settings.api_url
    )}|${cleanModelId(settings.model)}`;
}

function fallbackCatalog(settings, reason = "provider_unavailable") {
    const current = cleanModelId(settings.model);
    return {
        provider: String(settings.provider || "custom").trim(),
        models: current ? [current] : [],
        current_model: current,
        source: "fallback",
        cached: false,
        reason
    };
}

async function fetchJson(url, options, fetchImpl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, {
            ...options,
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`model list HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function normalizeModels(values) {
    return [...new Set(values.map(cleanModelId).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
    );
}

async function fetchProviderModels(settings, fetchImpl = fetch) {
    const provider = String(settings.provider || "custom").trim();
    const apiKey = providerKey(provider, settings);
    if (!apiKey) throw new Error("model list credential unavailable");
    const noAuth = apiKey === "__NO_AUTH__";

    if (provider === "gemini") {
        const endpoint = geminiModelsEndpoint(settings.api_url);
        if (!endpoint) throw new Error("invalid model list endpoint");
        const data = await fetchJson(
            endpoint,
            {
                method: "GET",
                headers: {
                    ...(noAuth ? {} : { "x-goog-api-key": apiKey }),
                    Accept: "application/json"
                }
            },
            fetchImpl
        );
        return normalizeModels(
            (data?.models || [])
                .filter(
                    (item) =>
                        !Array.isArray(item.supportedGenerationMethods) ||
                        item.supportedGenerationMethods.includes("generateContent")
                )
                .map((item) => String(item?.name || "").replace(/^models\//, ""))
        );
    }

    if (provider === "anthropic") {
        const data = await fetchJson(
            anthropicModelsEndpoint(settings.api_url),
            {
                method: "GET",
                headers: {
                    ...(noAuth ? {} : { "x-api-key": apiKey }),
                    "anthropic-version": "2023-06-01",
                    Accept: "application/json"
                }
            },
            fetchImpl
        );
        return normalizeModels((data?.data || []).map((item) => item?.id));
    }

    const endpoint = openAiModelsEndpoint(settings.api_url);
    if (!endpoint) throw new Error("invalid model list endpoint");
    const data = await fetchJson(
        endpoint,
        {
            method: "GET",
            headers: {
                ...(noAuth ? {} : { Authorization: "Bearer " + apiKey }),
                Accept: "application/json"
            }
        },
        fetchImpl
    );
    return normalizeModels((data?.data || data?.models || []).map((item) => item?.id || item));
}

async function listModels(settings, options = {}) {
    const now = Number(options.now ?? Date.now());
    const key = cacheKey(settings);
    const cached = modelCache.get(key);
    if (cached && cached.expiresAt > now) {
        return { ...cached.value, cached: true };
    }

    try {
        const models = await fetchProviderModels(settings, options.fetchImpl || fetch);
        const current = cleanModelId(settings.model);
        const complete = normalizeModels(current ? [...models, current] : models);
        if (complete.length === 0) {
            return fallbackCatalog(settings, "empty_provider_list");
        }
        const value = {
            provider: String(settings.provider || "custom").trim(),
            models: complete,
            current_model: current,
            source: "provider",
            cached: false,
            reason: null
        };
        modelCache.set(key, {
            expiresAt: now + MODEL_CACHE_TTL_MS,
            value
        });
        return value;
    } catch {
        return fallbackCatalog(settings);
    }
}

async function resolveTurnModel(settings, requestedModel, options = {}) {
    const requested = cleanModelId(requestedModel);
    const current = cleanModelId(settings.model);
    if (!requested || requested === current) return current;

    const catalog = await listModels(settings, options);
    if (!catalog.models.includes(requested)) {
        const error = new Error("请求的模型不在当前接口返回的可用模型列表中。");
        error.status = 400;
        error.code = "MODEL_NOT_AVAILABLE";
        throw error;
    }
    return requested;
}

function clearModelCache() {
    modelCache.clear();
}

module.exports = {
    MODEL_CACHE_TTL_MS,
    anthropicModelsEndpoint,
    cleanModelId,
    clearModelCache,
    fetchProviderModels,
    geminiModelsEndpoint,
    listModels,
    openAiModelsEndpoint,
    resolveTurnModel
};
