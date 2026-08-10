const assert = require("node:assert/strict");
const {
    MODEL_STREAM_CONNECT_TIMEOUT_MS,
    MODEL_STREAM_IDLE_TIMEOUT_MS,
    createModelStreamWatchdog
} = require("../services/model-stream-timeout");

const scheduled = new Map();
const cleared = [];
let nextTimerId = 1;
let timedOutPhase = "";
const watchdog = createModelStreamWatchdog({
    onTimeout(phase) {
        timedOutPhase = phase;
    },
    setTimer(callback, delay) {
        const id = nextTimerId;
        nextTimerId += 1;
        scheduled.set(id, { callback, delay });
        return id;
    },
    clearTimer(id) {
        cleared.push(id);
        scheduled.delete(id);
    }
});

watchdog.start();
assert.equal(scheduled.get(1).delay, MODEL_STREAM_CONNECT_TIMEOUT_MS);

watchdog.pulse();
assert.deepEqual(cleared, [1]);
assert.equal(scheduled.get(2).delay, MODEL_STREAM_IDLE_TIMEOUT_MS);

watchdog.pulse();
assert.deepEqual(cleared, [1, 2]);
assert.equal(scheduled.get(3).delay, MODEL_STREAM_IDLE_TIMEOUT_MS);
scheduled.get(3).callback();
assert.equal(timedOutPhase, "idle");

watchdog.stop();
assert.ok(cleared.includes(3));

console.log("model stream inactivity watchdog tests passed");
