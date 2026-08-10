const assert = require("node:assert/strict");
const {
    startModelWaitProgress
} = require("../services/model-wait-progress");

const scheduled = [];
const cleared = [];
const statuses = [];
const stop = startModelWaitProgress({
    onStatus(event) {
        statuses.push([event.stage, event.content]);
    },
    schedule(callback, delay) {
        const handle = { callback, delay };
        scheduled.push(handle);
        return handle;
    },
    cancel(handle) {
        cleared.push(handle);
    }
});

assert.deepEqual(
    scheduled.map((item) => item.delay),
    [8000, 30000, 75000]
);
scheduled.forEach((item) => item.callback());
assert.deepEqual(statuses, [
    ["model_deep_reasoning", "所选模型正在深入思考"],
    ["model_still_reasoning", "模型仍在推理，这次思考比平时更久"],
    ["model_extended_reasoning", "最高强度推理仍在继续，连接保持正常"]
]);
stop();
assert.equal(cleared.length, 3);

console.log("model wait progress checks passed");
