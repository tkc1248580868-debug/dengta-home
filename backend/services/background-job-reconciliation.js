const {
    scheduleProactiveMessageEvaluation
} = require("./tenant-proactive-message");
const { scheduleMomentPostEvaluation } = require("./tenant-moment-post");
const { scheduleDiaryUpdate } = require("./tenant-diary-update");
const { scheduleProfileRefresh } = require("./tenant-profile-refresh");

const RECURRING_JOB_TYPES = Object.freeze([
    "proactive_message",
    "moment_post",
    "diary_update",
    "profile_refresh"
]);

const DEFAULT_SCHEDULERS = Object.freeze({
    proactive_message: scheduleProactiveMessageEvaluation,
    moment_post: scheduleMomentPostEvaluation,
    diary_update: scheduleDiaryUpdate,
    profile_refresh: scheduleProfileRefresh
});

function reconciliationBucket(value = new Date()) {
    return new Date(value).toISOString().slice(0, 13);
}

async function listActiveRecurringJobs(database) {
    const { data, error } = await database
        .from("background_jobs")
        .select("job_type, status, due_at")
        .in("job_type", RECURRING_JOB_TYPES)
        .in("status", ["pending", "running"]);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function reconcileTenantRecurringJobs({
    database,
    getSettings,
    listActiveJobs = listActiveRecurringJobs,
    schedulers = DEFAULT_SCHEDULERS,
    now = () => new Date(),
    random = Math.random
} = {}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    if (typeof getSettings !== "function") {
        throw new TypeError("getSettings must be a function.");
    }
    if (typeof listActiveJobs !== "function") {
        throw new TypeError("listActiveJobs must be a function.");
    }

    const [settings, activeJobs] = await Promise.all([
        getSettings(database),
        listActiveJobs(database)
    ]);
    const activeTypes = new Set(
        (Array.isArray(activeJobs) ? activeJobs : [])
            .filter((job) => ["pending", "running"].includes(job?.status))
            .map((job) => String(job.job_type || ""))
            .filter((jobType) => RECURRING_JOB_TYPES.includes(jobType))
    );
    const bucket = reconciliationBucket(now());
    const result = {
        checked: RECURRING_JOB_TYPES.length,
        seeded: 0,
        alreadyActive: 0,
        disabled: 0
    };

    for (const jobType of RECURRING_JOB_TYPES) {
        if (jobType === "proactive_message" && settings.push_enabled !== true) {
            result.disabled += 1;
            continue;
        }
        if (activeTypes.has(jobType)) {
            result.alreadyActive += 1;
            continue;
        }

        const schedule = schedulers?.[jobType];
        if (typeof schedule !== "function") {
            throw new TypeError(`Missing reconciliation scheduler for ${jobType}.`);
        }
        const scheduled = await schedule({
            database,
            reconciliationId: bucket,
            now,
            random
        });
        if (scheduled?.scheduled === true) result.seeded += 1;
        else if (scheduled?.reason === "already_pending") {
            result.alreadyActive += 1;
        }
    }

    return result;
}

module.exports = {
    RECURRING_JOB_TYPES,
    listActiveRecurringJobs,
    reconcileTenantRecurringJobs,
    reconciliationBucket
};
