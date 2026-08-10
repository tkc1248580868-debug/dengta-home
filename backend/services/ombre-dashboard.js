const DEFAULT_TIMEOUT_MS = 8000;

let sessionCookie = "";
let loginPromise = null;

function cleanBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function getConfig() {
    const baseUrl = cleanBaseUrl(
        process.env.OMBRE_DASHBOARD_URL || process.env.OMBRE_BRAIN_URL
    );

    return {
        baseUrl,
        password: String(process.env.OMBRE_DASHBOARD_PASSWORD || ""),
        mcpToken: String(process.env.OMBRE_MCP_TOKEN || ""),
        timeoutMs: Math.max(
            1000,
            Number(process.env.OMBRE_DASHBOARD_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
        )
    };
}

function publicConfig() {
    const config = getConfig();
    let server = "";

    if (config.baseUrl) {
        try {
            server = new URL(config.baseUrl).origin;
        } catch {
            server = "invalid";
        }
    }

    return {
        configured: Boolean(config.baseUrl),
        server,
        dashboard_auth_configured: Boolean(config.password),
        mcp_auth_configured: Boolean(config.mcpToken),
        provider_independent: true
    };
}

function createError(message, code, status = 503) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function assertConfig(config) {
    if (!config.baseUrl) {
        throw createError(
            "尚未连接 Ombre 服务器。",
            "OMBRE_NOT_CONFIGURED",
            503
        );
    }

    let parsed;
    try {
        parsed = new URL(config.baseUrl);
    } catch {
        throw createError(
            "Ombre 服务器地址格式不正确。",
            "OMBRE_INVALID_URL",
            503
        );
    }

    if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
        throw createError(
            "Ombre 服务器必须使用 HTTPS。",
            "OMBRE_INVALID_URL",
            503
        );
    }

    if (!config.password) {
        throw createError(
            "尚未配置 Ombre Dashboard 凭据。",
            "OMBRE_AUTH_NOT_CONFIGURED",
            503
        );
    }
}

function captureCookie(headers) {
    const values =
        typeof headers.getSetCookie === "function"
            ? headers.getSetCookie()
            : [headers.get("set-cookie")].filter(Boolean);

    if (!values.length) return;

    sessionCookie = values
        .map((value) => String(value).split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (error?.name === "AbortError") {
            throw createError(
                "Ombre 服务器响应超时。",
                "OMBRE_TIMEOUT",
                504
            );
        }
        throw createError(
            "无法连接 Ombre 服务器。",
            "OMBRE_UNAVAILABLE",
            503
        );
    } finally {
        clearTimeout(timer);
    }
}

async function login() {
    const config = getConfig();
    assertConfig(config);

    const response = await fetchWithTimeout(
        `${config.baseUrl}/auth/login`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: config.password })
        },
        config.timeoutMs
    );

    captureCookie(response.headers);

    if (!response.ok || !sessionCookie) {
        sessionCookie = "";
        throw createError(
            "Ombre Dashboard 登录失败。",
            "OMBRE_AUTH_FAILED",
            502
        );
    }

    return sessionCookie;
}

async function ensureLoggedIn() {
    if (sessionCookie) return sessionCookie;

    if (!loginPromise) {
        loginPromise = login().finally(() => {
            loginPromise = null;
        });
    }

    return loginPromise;
}

async function dashboardRequest(path, retried = false) {
    const config = getConfig();
    assertConfig(config);
    await ensureLoggedIn();

    const cookieAtRequest = sessionCookie;
    const response = await fetchWithTimeout(
        `${config.baseUrl}${path}`,
        {
            method: "GET",
            headers: {
                Accept: "application/json",
                Cookie: cookieAtRequest
            }
        },
        config.timeoutMs
    );

    captureCookie(response.headers);

    if (response.status === 401 && !retried) {
        if (!sessionCookie || sessionCookie === cookieAtRequest) {
            sessionCookie = "";
            await ensureLoggedIn();
        }
        return dashboardRequest(path, true);
    }

    if (!response.ok) {
        throw createError(
            `Ombre Dashboard 返回 HTTP ${response.status}。`,
            response.status === 401
                ? "OMBRE_AUTH_FAILED"
                : "OMBRE_UPSTREAM_ERROR",
            response.status === 404 ? 404 : 502
        );
    }

    const data = await response.json().catch(() => null);
    if (data === null) {
        throw createError(
            "Ombre Dashboard 返回了无法读取的数据。",
            "OMBRE_INVALID_RESPONSE",
            502
        );
    }

    return {
        data,
        semanticSearch: response.headers.get("x-semantic-search") || ""
    };
}

function arrayValue(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
        return value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

function numberValue(...values) {
    const value = values.find(
        (item) => item !== undefined && item !== null && item !== ""
    );
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function booleanValue(value) {
    if (typeof value === "string") {
        return ["true", "1", "yes"].includes(value.toLowerCase());
    }
    return Boolean(value);
}

function textValue(value) {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function normalizeBucket(bucket = {}) {
    const metadata = bucket.metadata || bucket.meta || {};
    const content = textValue(
        bucket.content || bucket.text || bucket.body || bucket.display_content
    );
    const displayContent = textValue(bucket.display_content || content);
    const preview = textValue(
        bucket.content_preview ||
            bucket.contentPreview ||
            bucket.preview ||
            displayContent ||
            content
    );

    return {
        id: String(bucket.id || bucket.bucket_id || bucket.name || ""),
        name: String(
            bucket.name || bucket.title || metadata.name || bucket.id || "未命名记忆"
        ),
        content,
        displayContent,
        contentPreview: preview.replace(/\s+/g, " ").trim().slice(0, 220),
        type: String(bucket.type || metadata.type || "dynamic"),
        domains: arrayValue(bucket.domains || bucket.domain || metadata.domain),
        tags: arrayValue(bucket.tags || metadata.tags),
        importance: numberValue(bucket.importance, metadata.importance) ?? 5,
        valence: numberValue(bucket.valence, metadata.valence),
        arousal: numberValue(bucket.arousal, metadata.arousal),
        pinned: booleanValue(bucket.pinned ?? metadata.pinned),
        resolved: booleanValue(bucket.resolved ?? metadata.resolved),
        digested: booleanValue(bucket.digested ?? metadata.digested),
        activationCount:
            numberValue(bucket.activation_count, metadata.activation_count) ?? 0,
        createdAt:
            bucket.created_at || bucket.created || metadata.created || null,
        lastActiveAt:
            bucket.last_active_at ||
            bucket.last_active ||
            metadata.last_active ||
            bucket.created_at ||
            metadata.created ||
            null,
        score: numberValue(bucket.score),
        triggeredFeels: arrayValue(bucket.triggered_feels),
        metadata
    };
}

function listFromResponse(data) {
    if (Array.isArray(data)) return data;
    return data?.buckets || data?.items || data?.results || [];
}

function mapError(error) {
    const status = Number(error?.status) || 503;
    return {
        status,
        body: {
            available: false,
            error: error?.code || "OMBRE_UNAVAILABLE",
            message: error?.message || "Ombre 服务器暂时没有响应。"
        }
    };
}

module.exports = {
    dashboardRequest,
    getConfig,
    listFromResponse,
    mapError,
    normalizeBucket,
    publicConfig
};
