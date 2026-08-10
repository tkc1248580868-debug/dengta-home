const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 15_000;
const MAX_INTERVAL_MS = 15 * 60_000;

function normalizeInterval(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return DEFAULT_INTERVAL_MS;
    return Math.min(
        MAX_INTERVAL_MS,
        Math.max(MIN_INTERVAL_MS, parsed)
    );
}

function publicErrorCode(error) {
    const code = String(error?.code || "").trim();
    return /^[a-z][a-z0-9_]{0,63}$/.test(code)
        ? code
        : "background_job_run_failed";
}

function startBackgroundJobLoop({
    worker,
    enabled = false,
    intervalMs = DEFAULT_INTERVAL_MS,
    logger = console,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
} = {}) {
    if (!enabled) {
        return Object.freeze({
            started: Promise.resolve(),
            stop() {}
        });
    }
    if (!worker || typeof worker.runOnce !== "function") {
        throw new TypeError(
            "An enabled background-job loop requires a worker."
        );
    }

    const normalizedIntervalMs = normalizeInterval(intervalMs);
    let stopped = false;
    async function runTick() {
        if (stopped) return;
        try {
            await worker.runOnce();
        } catch (error) {
            logger?.error?.("background_job_local_loop_error", {
                errorCode: publicErrorCode(error)
            });
        }
    }

    const started = runTick();
    const timer = setIntervalFn(() => {
        void runTick();
    }, normalizedIntervalMs);
    timer?.unref?.();

    return Object.freeze({
        started,
        stop() {
            if (stopped) return;
            stopped = true;
            clearIntervalFn(timer);
        }
    });
}

module.exports = {
    DEFAULT_INTERVAL_MS,
    MAX_INTERVAL_MS,
    MIN_INTERVAL_MS,
    normalizeInterval,
    startBackgroundJobLoop
};
