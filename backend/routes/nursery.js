const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const {
    applyNurseryAction,
    companionNurseryAction,
    createUnnamedChild,
    getNurseryPortrait,
    getNurserySnapshot,
    nameNurseryChild
} = require("../services/nursery");
const { scheduleNextNurseryEvent } = require("../services/nursery-events");

function isMissingNurserySchema(error) {
    return (
        error?.code === "42P01" ||
        error?.code === "PGRST205" ||
        /nursery_.*does not exist|could not find.*nursery_/i.test(
            error?.message || ""
        )
    );
}

function childNotFound() {
    const error = new Error("找不到这个孩子。");
    error.status = 404;
    error.code = "nursery_child_not_found";
    return error;
}

function createNurseryRouter({
    now = () => new Date(),
    scheduleEvent = scheduleNextNurseryEvent
} = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        try {
            requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json(await getNurserySnapshot({ database: scope.db, now }));
        } catch (error) {
            if (isMissingNurserySchema(error)) {
                res.json({
                    available: false,
                    child: null,
                    message: "育儿房数据库正在升级。",
                    provider_calls: 0,
                    embedding_calls: 0
                });
                return;
            }
            next(error);
        }
    });

    router.post("/children", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await createUnnamedChild({
                database: scope.db,
                clientActionId: req.body?.client_action_id,
                now
            });
            if (result.created && result.child?.id) {
                const scheduled = await scheduleEvent({
                    database: scope.db,
                    childId: result.child.id,
                    sourceKey: "birth",
                    now
                });
                result.next_event = scheduled.event || null;
            }
            res.status(result.created ? 201 : 200).json(result);
        } catch (error) {
            next(error);
        }
    });

    router.post("/children/:childId/name", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json(
                await nameNurseryChild({
                    database: scope.db,
                    childId: req.params.childId,
                    candidates: req.body?.candidates ?? req.body?.name,
                    clientActionId: req.body?.client_action_id,
                    now
                })
            );
        } catch (error) {
            next(error);
        }
    });

    router.post("/children/:childId/actions", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json(
                await applyNurseryAction({
                    database: scope.db,
                    childId: req.params.childId,
                    actor: "user",
                    action: req.body?.action,
                    text: req.body?.text,
                    clientActionId: req.body?.client_action_id,
                    now
                })
            );
        } catch (error) {
            next(error);
        }
    });

    router.post(
        "/children/:childId/companion-actions",
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                res.json(
                    await companionNurseryAction({
                        database: scope.db,
                        childId: req.params.childId,
                        clientActionId: req.body?.client_action_id,
                        now
                    })
                );
            } catch (error) {
                next(error);
            }
        }
    );

    router.get("/children/:childId/album", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const snapshot = await getNurserySnapshot({
                database: scope.db,
                now
            });
            if (snapshot.child?.id !== req.params.childId) {
                throw childNotFound();
            }
            res.json({ milestones: snapshot.milestones });
        } catch (error) {
            next(error);
        }
    });

    router.get("/children/:childId/portrait", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const snapshot = await getNurserySnapshot({
                database: scope.db,
                now
            });
            if (snapshot.child?.id !== req.params.childId) {
                throw childNotFound();
            }
            res.json({
                portrait: await getNurseryPortrait({
                    database: scope.db,
                    childId: req.params.childId,
                    now
                })
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/children/:childId/events", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const snapshot = await getNurserySnapshot({
                database: scope.db,
                now
            });
            if (snapshot.child?.id !== req.params.childId) {
                throw childNotFound();
            }
            res.json({ events: snapshot.events });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createNurseryRouter };
