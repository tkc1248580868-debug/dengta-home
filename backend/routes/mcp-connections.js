const express = require("express");
const { requireRequestScope } = require("../services/request-scope");

function sendError(res, error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
        console.error("MCP 设备中心请求失败：", error?.code || error?.message || "unknown");
    }
    res.status(status).json({
        ok: false,
        error: error?.code || "MCP_DEVICE_CENTER_ERROR",
        message: error?.message || "设备中心暂时无法完成请求。"
    });
}

function createAttemptGuard({ windowMs = 15 * 60 * 1000, maxAttempts = 10 } = {}) {
    const attempts = new Map();
    return {
        consume(key) {
            const now = Date.now();
            const current = attempts.get(key) || { count: 0, resetAt: now + windowMs };
            if (current.resetAt <= now) {
                current.count = 0;
                current.resetAt = now + windowMs;
            }
            current.count += 1;
            attempts.set(key, current);
            return { allowed: current.count <= maxAttempts, retryAfterMs: Math.max(0, current.resetAt - now) };
        },
        clear(key) {
            attempts.delete(key);
        }
    };
}

function createMcpConnectionsRouter({ center } = {}) {
    const router = express.Router();

    router.use((req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            req.mcpCenter = center.forDatabase(scope.db);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/status", async (req, res) => {
        try {
            res.json(await req.mcpCenter.status());
        } catch (error) {
            sendError(res, error);
        }
    });

    router.use("/manage", (req, res, next) => {
        res.set("Cache-Control", "no-store");
        next();
    });

    router.get("/manage", async (req, res) => {
        try {
            res.json({
                ok: true,
                connections: await req.mcpCenter.listConnections()
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post("/manage/discover", async (req, res) => {
        try {
            res.json({
                ok: true,
                ...(await req.mcpCenter.discoverDraft(req.body || {}))
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post("/manage", async (req, res) => {
        try {
            res.status(201).json({
                ok: true,
                connection: await req.mcpCenter.createConnection(
                    req.body || {}
                )
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.put("/manage/:id", async (req, res) => {
        try {
            res.json({
                ok: true,
                connection: await req.mcpCenter.updateConnection(
                    req.params.id,
                    req.body || {}
                )
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post("/manage/:id/test", async (req, res) => {
        try {
            res.json({
                ok: true,
                ...(await req.mcpCenter.testConnection(req.params.id))
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.delete("/manage/:id", async (req, res) => {
        try {
            res.json({
                ok: true,
                ...(await req.mcpCenter.deleteConnection(req.params.id))
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}

module.exports = { createAttemptGuard, createMcpConnectionsRouter };
