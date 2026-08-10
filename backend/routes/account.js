const express = require("express");
const { requireRequestScope } = require("../services/request-scope");

const requireScope = requireRequestScope;

function createAccountRouter() {
    const router = express.Router();

    router.get("/", (req, res, next) => {
        try {
            const scope = requireScope(req);
            res.json({
                user: {
                    id: scope.user.id,
                    email: scope.user.email,
                    email_verified: true
                },
                profile: scope.profile,
                companions: scope.companions,
                active_companion: scope.companion
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/companions", async (req, res, next) => {
        try {
            const scope = requireScope(req);
            const name = String(req.body?.name || "").trim().slice(0, 80);
            if (!name) {
                res.status(400).json({
                    code: "companion_name_required",
                    message: "请填写伴侣名称。"
                });
                return;
            }
            const { count, error: countError } = await scope.db
                .from("companions")
                .select("id", { count: "exact", head: true })
                .eq("status", "active");
            if (countError) throw countError;
            if ((count || 0) >= scope.profile.companion_limit) {
                res.status(409).json({
                    code: "companion_limit_reached",
                    message: "当前伴侣名额已用完。"
                });
                return;
            }
            const { data, error } = await scope.db
                .from("companions")
                .insert({ name, is_default: false })
                .select("id, name, is_default, status, created_at, updated_at")
                .single();
            if (error) throw error;
            res.status(201).json({ companion: data });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createAccountRouter, requireScope };
