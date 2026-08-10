const assert = require("node:assert/strict");
const {
    interactiveGenerationSettings
} = require("../services/interactive-generation-profile");

const configured = {
    model: "gpt-5.6-sol",
    reasoning_effort: "max",
    max_tokens: 50000,
    request_timeout_ms: 300000
};

const duel = interactiveGenerationSettings(configured, "intimate_duel");
assert.equal(duel.model, configured.model);
assert.equal(duel.reasoning_effort, "low");
assert.equal(duel.max_tokens, 1200);
assert.equal(duel.request_timeout_ms, 90000);

const inner = interactiveGenerationSettings(
    configured,
    "visible_inner_monologue"
);
assert.equal(inner.model, configured.model);
assert.equal(inner.reasoning_effort, "medium");
assert.equal(inner.max_tokens, 3000);
assert.equal(inner.request_timeout_ms, 120000);

const chat = interactiveGenerationSettings(configured, "main_chat");
assert.deepEqual(chat, configured);

console.log("interactive generation latency profile checks passed");
