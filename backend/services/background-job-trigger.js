const {
    createHash,
    timingSafeEqual
} = require("node:crypto");

const DEFAULT_BUDGET_MS = 8000;
const MAX_BUDGET_MS = 60000;

function constantTimeSecretEqual(provided, expected) {
    const providedDigest = createHash("sha256")
        .update(String(provided || ""), "utf8")
        .digest();
    const expectedDigest = createHash("sha256")
        .update(String(expected || ""), "utf8")
        .digest();
    return timingSafeEqual(providedDigest, expectedDigest);
}

function requestHeader(req, name) {
    if (typeof req?.get === "function") {
        const value = req.get(name);
        return Array.isArray(value) ? "" : String(value || "").trim();
    }

    const headers = req?.headers;
    if (!headers || typeof headers !== "object") return "";
    const normalizedName = name.toLowerCase();
    const entry = Object.entries(headers).find(
        ([key]) => String(key).toLowerCase() === normalizedName
    );
    if (!entry || Array.isArray(entry[1])) return "";
    return String(entry[1] || "").trim();
}

function requestCredentials(req) {
    const credentials = [];
    const authorization = requestHeader(req, "authorization");
    const bearer = /^Bearer ([^\s,]+)$/i.exec(authorization);
    if (bearer) credentials.push(bearer[1]);

    const internalHeader = requestHeader(
        req,
        "x-dengta-job-secret"
    );
    if (internalHeader && !/[\s,]/.test(internalHeader)) {
        credentials.push(internalHeader);
    }
    return credentials;
}

function createBackgroundJobTrigger({
    worker,
    secret,
    enabled = false,
    budgetMs = DEFAULT_BUDGET_MS
} = {}) {
    const expectedSecret = String(secret || "").trim();
    const normalizedBudgetMs = Number(budgetMs);
    const available =
        enabled === true &&
        expectedSecret.length > 0 &&
        typeof worker?.runOnce === "function" &&
        Number.isInteger(normalizedBudgetMs) &&
        normalizedBudgetMs >= 1 &&
        normalizedBudgetMs <= MAX_BUDGET_MS;

    return async function backgroundJobTrigger(req, res) {
        if (!available) {
            return res.status(503).json({
                ok: false,
                code: "background_job_trigger_unavailable"
            });
        }

        const authorized = requestCredentials(req).some((credential) =>
            constantTimeSecretEqual(credential, expectedSecret)
        );
        if (!authorized) {
            return res.status(401).json({
                ok: false,
                code: "background_job_trigger_unauthorized"
            });
        }

        const runOutcome = Promise.resolve()
            .then(() => worker.runOnce())
            .then(
                () => "completed",
                () => "failed"
            );
        let budgetTimer;
        const budgetOutcome = new Promise((resolve) => {
            budgetTimer = setTimeout(
                () => resolve("running"),
                normalizedBudgetMs
            );
            budgetTimer?.unref?.();
        });
        const outcome = await Promise.race([
            runOutcome,
            budgetOutcome
        ]);

        if (outcome !== "running") {
            clearTimeout(budgetTimer);
        }
        if (outcome === "running") {
            return res.status(202).json({
                ok: true,
                code: "background_job_trigger_accepted",
                status: "running"
            });
        }
        if (outcome === "completed") {
            return res.status(200).json({
                ok: true,
                code: "background_job_trigger_completed",
                status: "completed"
            });
        }
        return res.status(500).json({
            ok: false,
            code: "background_job_trigger_failed"
        });
    };
}

module.exports = {
    DEFAULT_BUDGET_MS,
    MAX_BUDGET_MS,
    createBackgroundJobTrigger
};
