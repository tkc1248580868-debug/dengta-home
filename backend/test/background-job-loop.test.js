const assert = require("node:assert/strict");
const {
    startBackgroundJobLoop
} = require("../services/background-job-loop");

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
}

(async () => {
    {
        let runs = 0;
        let intervalCallback = null;
        let clearedTimer = null;
        let unrefCalled = false;
        const timer = {
            unref() {
                unrefCalled = true;
            }
        };
        const loop = startBackgroundJobLoop({
            enabled: true,
            intervalMs: 60_000,
            worker: {
                async runOnce() {
                    runs += 1;
                }
            },
            setIntervalFn(callback, delay) {
                assert.equal(delay, 60_000);
                intervalCallback = callback;
                return timer;
            },
            clearIntervalFn(value) {
                clearedTimer = value;
            }
        });

        await loop.started;
        assert.equal(
            runs,
            1,
            "an enabled production process must check due jobs immediately",
        );
        assert.equal(unrefCalled, true);

        intervalCallback();
        await flushPromises();
        assert.equal(runs, 2, "the local loop must keep checking due jobs");

        loop.stop();
        assert.equal(clearedTimer, timer);
    }

    {
        let runs = 0;
        let scheduled = false;
        const loop = startBackgroundJobLoop({
            enabled: false,
            worker: {
                async runOnce() {
                    runs += 1;
                }
            },
            setIntervalFn() {
                scheduled = true;
            }
        });

        await loop.started;
        assert.equal(runs, 0);
        assert.equal(scheduled, false);
        loop.stop();
    }

    {
        const logged = [];
        let intervalCallback = null;
        const loop = startBackgroundJobLoop({
            enabled: true,
            worker: {
                async runOnce() {
                    throw Object.assign(new Error("provider secret"), {
                        code: "provider_failed"
                    });
                }
            },
            logger: {
                error(event, metadata) {
                    logged.push({ event, metadata });
                }
            },
            setIntervalFn(callback) {
                intervalCallback = callback;
                return { unref() {} };
            },
            clearIntervalFn() {}
        });

        await loop.started;
        assert.deepEqual(logged, [
            {
                event: "background_job_local_loop_error",
                metadata: { errorCode: "provider_failed" }
            }
        ]);
        intervalCallback();
        await flushPromises();
        assert.equal(logged.length, 2);
        loop.stop();
    }

    console.log("background job local loop tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
