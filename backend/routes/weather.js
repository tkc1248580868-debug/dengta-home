const express = require("express");
const { createVoiceRateLimitState } = require("../services/voice-turn");
const { createWeatherService } = require("../services/weather-service");

function createWeatherRouter({
    weatherService = createWeatherService(),
    rateLimitState = createVoiceRateLimitState({
        windowMs: process.env.WEATHER_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000,
        maxRequests: process.env.WEATHER_RATE_LIMIT_MAX || 30
    })
} = {}) {
    const router = express.Router();
    router.use(express.json({ limit: "4kb", strict: true }));

    router.post("/current", async (req, res, next) => {
        const limit = rateLimitState.consume(
            req.ip || req.socket?.remoteAddress || "unknown"
        );
        if (!limit.allowed) {
            res.set(
                "Retry-After",
                String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000)))
            );
            return res.status(429).json({
                ok: false,
                code: "WEATHER_RATE_LIMITED",
                message: "天气刷新太频繁了，请稍后再试。"
            });
        }

        try {
            const result = await weatherService.getCurrentWeather({
                latitude: req.body?.latitude,
                longitude: req.body?.longitude
            });
            res.set("Cache-Control", "private, max-age=300");
            return res.json({ ok: true, ...result });
        } catch (error) {
            if (
                Number.isInteger(error?.status) &&
                /^WEATHER_|^INVALID_COORDINATE$/.test(String(error?.code || ""))
            ) {
                return res.status(error.status).json({
                    ok: false,
                    code: error.code,
                    message: error.message
                });
            }
            return next(error);
        }
    });

    return router;
}

module.exports = { createWeatherRouter };
