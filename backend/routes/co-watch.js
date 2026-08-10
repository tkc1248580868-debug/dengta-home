const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const { runCoWatchFrame } = require("../services/co-watch");

const MAX_FRAME_BYTES = 1_500_000;

function createCoWatchRouter(services = {}) {
    const router = express.Router();
    router.post(
        "/frame",
        express.raw({
            type: ["image/jpeg", "image/png"],
            limit: MAX_FRAME_BYTES
        }),
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                const result = await runCoWatchFrame({
                    database: scope.db,
                    frame: {
                        sessionId: req.query.session_id,
                        epoch: req.query.epoch,
                        sequence: req.query.sequence,
                        capturedAt: req.query.captured_at,
                        mimeType: req.headers["content-type"]
                    },
                    image: req.body,
                    ...services
                });
                res.set("Cache-Control", "private, no-store");
                res.status(result.status === "created" ? 201 : 200).json({
                    status: result.status,
                    reaction: result.reaction,
                    message_id: result.messageId,
                    conversation_id: result.conversationId,
                    ai_name: result.aiName || ""
                });
            } catch (error) {
                next(error);
            }
        }
    );
    return router;
}

module.exports = { MAX_FRAME_BYTES, createCoWatchRouter };
