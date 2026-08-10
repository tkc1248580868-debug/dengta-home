const router = require("express").Router();
const {
    dashboardRequest,
    listFromResponse,
    mapError,
    normalizeBucket,
    publicConfig
} = require("../services/ombre-dashboard");
const {
    getOmbreMcpStatus,
    mapMcpError,
    publicMcpConfig
} = require("../services/ombre-mcp");

function sendError(res, error) {
    const mapped = mapError(error);
    console.error("Ombre Dashboard 请求失败：", error?.code || "unknown");
    res.status(mapped.status).json(mapped.body);
}

function normalizedItems(data) {
    return listFromResponse(data)
        .map((item) => normalizeBucket(item))
        .filter((item) => item.id);
}

router.get("/config", (req, res) => {
    res.json({
        ...publicConfig(),
        mcp: publicMcpConfig()
    });
});

router.get("/mcp/status", async (req, res) => {
    const config = publicMcpConfig();
    if (!config.configured) {
        res.json({
            ...config,
            available: false,
            session_established: false,
            tools: [],
            message: "等待配置 Ombre MCP 服务器。"
        });
        return;
    }

    try {
        res.json(await getOmbreMcpStatus());
    } catch (error) {
        const mapped = mapMcpError(error);
        console.error("Ombre MCP 状态检查失败：", error?.code || "unknown");
        res.status(mapped.status).json({
            ...config,
            ...mapped.body,
            session_established: false,
            tools: []
        });
    }
});

router.get("/status", async (req, res) => {
    const config = publicConfig();
    if (!config.configured) {
        res.json({
            ...config,
            available: false,
            total: 0,
            message: "尚未连接 Ombre 服务器。"
        });
        return;
    }

    try {
        const response = await dashboardRequest("/api/buckets");
        const items = normalizedItems(response.data);
        res.json({
            ...config,
            available: true,
            total: items.length,
            message: "Ombre 服务器已连接。"
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/buckets", async (req, res) => {
    try {
        const response = await dashboardRequest("/api/buckets");
        let items = normalizedItems(response.data);
        const type = String(req.query.type || "").toLowerCase();
        const state = String(req.query.state || "").toLowerCase();

        if (type) {
            items = items.filter((item) => item.type.toLowerCase() === type);
        }
        if (state === "pinned") {
            items = items.filter((item) => item.pinned);
        }
        if (state === "resolved") {
            items = items.filter((item) => item.resolved);
        }

        items.sort(
            (left, right) =>
                new Date(right.lastActiveAt || 0) -
                new Date(left.lastActiveAt || 0)
        );

        res.json({ items, total: items.length });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/search", async (req, res) => {
    const query = String(req.query.q || "").trim().slice(0, 160);
    if (!query) {
        res.json({ items: [], total: 0, query: "", semanticSearch: "" });
        return;
    }

    try {
        const response = await dashboardRequest(
            `/api/search?q=${encodeURIComponent(query)}`
        );
        const items = normalizedItems(response.data);
        res.json({
            items,
            total: items.length,
            query,
            semanticSearch: response.semanticSearch
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/buckets/:id", async (req, res) => {
    try {
        const response = await dashboardRequest(
            `/api/bucket/${encodeURIComponent(req.params.id)}`
        );
        res.json(normalizeBucket(response.data?.bucket || response.data));
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = router;
