const express = require("express");
const {
    publicProviderError
} = require("../services/ai-provider-center");
const { requireRequestScope } = require("../services/request-scope");

function sendError(res, error) {
    const safe = publicProviderError(error);
    if (safe.status >= 500) {
        console.error(
            "多接口控制台请求失败：",
            [
                safe.code,
                `status=${safe.status}`,
                safe.upstream_status
                    ? `upstream_status=${safe.upstream_status}`
                    : ""
            ]
                .filter(Boolean)
                .join(" ")
        );
    }
    res.status(safe.status).json({
        ok: false,
        error: safe.code,
        message: safe.message,
        ...(safe.upstream_status
            ? { upstream_status: safe.upstream_status }
            : {})
    });
}

function createAiProvidersRouter({ center } = {}) {
    const router = express.Router();

    router.use((req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            req.aiProviderCenter = center.forDatabase(scope.db);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/status", async (req, res) => {
        try {
            res.json(await req.aiProviderCenter.status());
        } catch (error) {
            sendError(res, error);
        }
    });

    router.get("/manage", async (req, res) => {
        try {
            res.json({
                ok: true,
                profiles: await req.aiProviderCenter.listProfiles()
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post("/manage/test", async (req, res) => {
        try {
            res.json(
                await req.aiProviderCenter.testDraft(req.body || {})
            );
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post("/manage", async (req, res) => {
        try {
            res.status(201).json({
                ok: true,
                profile: await req.aiProviderCenter.createProfile(
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
                profile: await req.aiProviderCenter.updateProfile(
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
                ...(await req.aiProviderCenter.testProfile(
                    req.params.id
                ))
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post("/manage/:id/default", async (req, res) => {
        try {
            res.json({
                ok: true,
                profile: await req.aiProviderCenter.setDefault(
                    req.params.id
                )
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.delete("/manage/:id", async (req, res) => {
        try {
            res.json({
                ok: true,
                ...(await req.aiProviderCenter.deleteProfile(
                    req.params.id
                ))
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}

module.exports = { createAiProvidersRouter };
