const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

function cleanBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function getMcpConfig(env = process.env) {
    const baseUrl = cleanBaseUrl(env.OMBRE_BRAIN_URL);
    return {
        baseUrl,
        endpoint: baseUrl
            ? /\/mcp$/i.test(baseUrl)
                ? baseUrl
                : `${baseUrl}/mcp`
            : "",
        token: String(env.OMBRE_MCP_TOKEN || "").trim(),
        timeoutMs: Math.max(
            1000,
            Number(env.OMBRE_MCP_TIMEOUT_MS) ||
                Number(env.OMBRE_DASHBOARD_TIMEOUT_MS) ||
                DEFAULT_TIMEOUT_MS
        ),
        protocolVersion: String(
            env.OMBRE_MCP_PROTOCOL_VERSION || DEFAULT_PROTOCOL_VERSION
        ).trim()
    };
}

function normalizeMcpConfig(value = {}, env = process.env) {
    const endpoint = cleanBaseUrl(value.endpoint || value.baseUrl);
    return {
        baseUrl: cleanBaseUrl(value.baseUrl || endpoint),
        endpoint,
        token: String(value.token || "").trim(),
        authHeader: String(value.authHeader || "Authorization").trim(),
        authScheme:
            value.authScheme === null || value.authScheme === undefined
                ? "Bearer"
                : String(value.authScheme).trim(),
        timeoutMs: Math.max(
            1000,
            Number(value.timeoutMs) || DEFAULT_TIMEOUT_MS
        ),
        protocolVersion: String(
            value.protocolVersion || DEFAULT_PROTOCOL_VERSION
        ).trim(),
        displayName: String(value.displayName || "MCP").trim().slice(0, 80),
        production: value.production ?? env.NODE_ENV === "production"
    };
}

function createMcpError(message, code, status = 503, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    Object.assign(error, details);
    return error;
}

function assertMcpConfig(config, env = process.env) {
    if (!config.baseUrl) {
        throw createMcpError(
            "尚未配置 Ombre MCP 服务器。",
            "OMBRE_MCP_NOT_CONFIGURED",
            503
        );
    }

    let parsed;
    try {
        parsed = new URL(config.endpoint);
    } catch {
        throw createMcpError(
            "Ombre MCP 地址格式不正确。",
            "OMBRE_MCP_INVALID_URL",
            503
        );
    }

    if (
        parsed.protocol !== "https:" &&
        (config.production ?? env.NODE_ENV === "production")
    ) {
        throw createMcpError(
            "生产环境的 Ombre MCP 必须使用 HTTPS。",
            "OMBRE_MCP_INVALID_URL",
            503
        );
    }
}

function parseMcpPayload(text) {
    const source = String(text || "").trim();
    if (!source) return null;

    try {
        return JSON.parse(source);
    } catch {
        // Continue with the SSE parser below.
    }

    const events = [];
    let dataLines = [];

    function flushEvent() {
        if (dataLines.length === 0) return;
        const data = dataLines.join("\n").trim();
        dataLines = [];
        if (!data || data === "[DONE]") return;
        try {
            events.push(JSON.parse(data));
        } catch {
            // Ignore non-JSON keepalive events.
        }
    }

    for (const line of source.split(/\r?\n/)) {
        if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
        } else if (!line.trim()) {
            flushEvent();
        }
    }
    flushEvent();

    return (
        [...events]
            .reverse()
            .find(
                (item) =>
                    item &&
                    typeof item === "object" &&
                    (item.result !== undefined || item.error || item.jsonrpc)
            ) ||
        events.at(-1) ||
        null
    );
}

function extractMcpText(value) {
    const result = value?.result || value || {};
    const content = Array.isArray(result.content) ? result.content : [];
    return content
        .map((item) => {
            if (item?.type === "text") return String(item.text || "");
            if (item?.type === "json" && item.json !== undefined) {
                return JSON.stringify(item.json);
            }
            return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
}

function normalizeMcpTools(value) {
    const tools = Array.isArray(value?.result?.tools)
        ? value.result.tools
        : Array.isArray(value?.tools)
          ? value.tools
          : [];

    return tools
        .map((tool) => ({
            name: String(tool?.name || "").trim(),
            description: String(tool?.description || "").trim().slice(0, 500),
            inputSchema:
                tool?.inputSchema && typeof tool.inputSchema === "object"
                    ? tool.inputSchema
                    : { type: "object", properties: {} }
        }))
        .filter((tool) => tool.name);
}

function publicMcpConfig(env = process.env) {
    const config = getMcpConfig(env);
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
        auth_configured: Boolean(config.token),
        protocol_version: config.protocolVersion,
        provider_independent: true
    };
}

function createOmbreMcpClient({
    env = process.env,
    config: configOverride = null,
    fetchImpl = (...args) => globalThis.fetch(...args)
} = {}) {
    let sessionId = "";
    let callId = 0;
    let initializePromise = null;
    let initializedOnce = false;
    let serverInfo = null;
    let serverCapabilities = {};

    function resetSession() {
        sessionId = "";
        serverInfo = null;
        serverCapabilities = {};
        initializedOnce = false;
    }

    function requestHeaders(config, includeSession) {
        const headers = {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": config.protocolVersion
        };
        if (includeSession && sessionId) {
            headers["Mcp-Session-Id"] = sessionId;
        }
        if (config.token) {
            const authHeader = String(config.authHeader || "Authorization");
            const authScheme =
                config.authScheme === undefined ? "Bearer" : config.authScheme;
            const authValue = authScheme
                ? `${authScheme} ${config.token}`
                : config.token;
            headers[authHeader] = authValue;
        }
        return headers;
    }

    function resolveConfig() {
        return configOverride
            ? normalizeMcpConfig(configOverride, env)
            : getMcpConfig(env);
    }

    async function request(payload, { includeSession = true } = {}) {
        const config = resolveConfig();
        assertMcpConfig(config, env);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        let response;

        try {
            response = await fetchImpl(config.endpoint, {
                method: "POST",
                headers: requestHeaders(config, includeSession),
                body: JSON.stringify(payload),
                signal: controller.signal,
                redirect: "error"
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw createMcpError(
                    "Ombre MCP 响应超时。",
                    "OMBRE_MCP_TIMEOUT",
                    504
                );
            }
            throw createMcpError(
                "无法连接 Ombre MCP 服务器。",
                "OMBRE_MCP_UNAVAILABLE",
                503
            );
        } finally {
            clearTimeout(timer);
        }

        const rawText = await response.text().catch(() => "");
        const parsed = parseMcpPayload(rawText);

        if (!response.ok) {
            throw createMcpError(
                `Ombre MCP 返回 HTTP ${response.status}。`,
                "OMBRE_MCP_UPSTREAM_ERROR",
                response.status === 401 || response.status === 403 ? 502 : 503,
                { upstreamStatus: response.status }
            );
        }

        if (parsed?.error) {
            throw createMcpError(
                "Ombre MCP 拒绝了本次协议请求。",
                "OMBRE_MCP_RPC_ERROR",
                502,
                { rpcCode: parsed.error.code }
            );
        }

        return { response, payload: parsed };
    }

    async function initialize(force = false) {
        if (!force && initializedOnce) {
            return {
                sessionId,
                serverInfo,
                capabilities: serverCapabilities
            };
        }
        if (initializePromise) return initializePromise;

        initializePromise = (async () => {
            if (force) resetSession();
            const config = resolveConfig();
            const initialized = await request(
                {
                    jsonrpc: "2.0",
                    method: "initialize",
                    params: {
                        protocolVersion: config.protocolVersion,
                        capabilities: {},
                        clientInfo: {
                            name: "dengta-home-backend",
                            version: "0.13.0"
                        }
                    },
                    id: ++callId
                },
                { includeSession: false }
            );

            sessionId = String(
                initialized.response.headers.get("mcp-session-id") || ""
            ).trim();
            serverInfo = initialized.payload?.result?.serverInfo || null;
            serverCapabilities =
                initialized.payload?.result?.capabilities || {};

            await request({
                jsonrpc: "2.0",
                method: "notifications/initialized"
            });
            initializedOnce = true;

            return {
                sessionId,
                serverInfo,
                capabilities: serverCapabilities
            };
        })().finally(() => {
            initializePromise = null;
        });

        return initializePromise;
    }

    async function listTools() {
        await initialize();
        const response = await request({
            jsonrpc: "2.0",
            method: "tools/list",
            params: {},
            id: ++callId
        });
        return normalizeMcpTools(response.payload);
    }

    async function callTool(name, args = {}, retried = false) {
        const toolName = String(name || "").trim();
        if (!toolName) {
            throw createMcpError(
                "MCP 工具名称不能为空。",
                "OMBRE_MCP_INVALID_TOOL",
                400
            );
        }

        try {
            await initialize();
            const response = await request({
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments:
                        args && typeof args === "object" && !Array.isArray(args)
                            ? args
                            : {}
                },
                id: ++callId
            });
            return {
                text: extractMcpText(response.payload),
                result: response.payload?.result || null
            };
        } catch (error) {
            const retryable =
                !retried &&
                (error?.upstreamStatus === 400 ||
                    error?.upstreamStatus === 404 ||
                    error?.upstreamStatus === 409 ||
                    error?.code === "OMBRE_MCP_RPC_ERROR");
            if (!retryable) throw error;
            resetSession();
            await initialize(true);
            return callTool(toolName, args, true);
        }
    }

    async function status() {
        const resolved = resolveConfig();
        const publicConfig = configOverride
            ? {
                  configured: Boolean(resolved.endpoint),
                  server: (() => {
                      try {
                          return resolved.endpoint
                              ? new URL(resolved.endpoint).origin
                              : "";
                      } catch {
                          return "invalid";
                      }
                  })(),
                  auth_configured: Boolean(resolved.token),
                  protocol_version: resolved.protocolVersion,
                  provider_independent: true
              }
            : publicMcpConfig(env);
        if (!publicConfig.configured) {
            return {
                ...publicConfig,
                available: false,
                session_established: false,
                tools: [],
                message: "等待配置 Ombre MCP 服务器。"
            };
        }

        const initialized = await initialize();
        const tools = await listTools();
        return {
            ...publicConfig,
            available: true,
            session_established: Boolean(initialized.sessionId),
            server_name: String(initialized.serverInfo?.name || ""),
            server_version: String(initialized.serverInfo?.version || ""),
            tools: tools.map((tool) => tool.name),
            message: `MCP 已连接，发现 ${tools.length} 个工具。`
        };
    }

    return {
        callTool,
        initialize,
        listTools,
        resetSession,
        status
    };
}

const defaultClient = createOmbreMcpClient();

function mapMcpError(error) {
    return {
        status: Number(error?.status) || 503,
        body: {
            available: false,
            error: error?.code || "OMBRE_MCP_UNAVAILABLE",
            message: error?.message || "Ombre MCP 暂时没有响应。"
        }
    };
}

module.exports = {
    createOmbreMcpClient,
    extractMcpText,
    getMcpConfig,
    mapMcpError,
    normalizeMcpTools,
    normalizeMcpConfig,
    parseMcpPayload,
    publicMcpConfig,
    callOmbreTool: defaultClient.callTool,
    getOmbreMcpStatus: defaultClient.status,
    listOmbreTools: defaultClient.listTools
};
