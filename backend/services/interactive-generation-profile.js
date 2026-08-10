const PROFILE_LIMITS = Object.freeze({
    intimate_duel: Object.freeze({
        reasoning_effort: "low",
        max_tokens: 1200,
        request_timeout_ms: 90000
    }),
    visible_inner_monologue: Object.freeze({
        reasoning_effort: "medium",
        max_tokens: 3000,
        request_timeout_ms: 120000
    })
});

function interactiveGenerationSettings(settings = {}, purpose = "") {
    const limits = PROFILE_LIMITS[String(purpose || "").trim()];
    return limits ? { ...settings, ...limits } : settings;
}

module.exports = {
    interactiveGenerationSettings
};
