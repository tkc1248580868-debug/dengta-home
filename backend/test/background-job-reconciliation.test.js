const assert = require("node:assert/strict");
const {
    RECURRING_JOB_TYPES,
    reconcileTenantRecurringJobs,
    reconciliationBucket
} = require("../services/background-job-reconciliation");

assert.deepEqual(RECURRING_JOB_TYPES, [
    "proactive_message",
    "moment_post",
    "diary_update",
    "profile_refresh"
]);
assert.equal(
    reconciliationBucket(new Date("2026-07-29T02:37:00.000Z")),
    "2026-07-29T02"
);

async function testSeedsOnlyMissingRecurringChains() {
    const calls = [];
    const schedulers = Object.fromEntries(
        RECURRING_JOB_TYPES.map((jobType) => [
            jobType,
            async (options) => {
                calls.push({ jobType, options });
                return { scheduled: true, reason: "scheduled" };
            }
        ])
    );
    const result = await reconcileTenantRecurringJobs({
        database: { from() {} },
        async getSettings() {
            return { push_enabled: true };
        },
        async listActiveJobs() {
            return [
                { job_type: "moment_post", status: "pending" },
                { job_type: "diary_update", status: "running" }
            ];
        },
        schedulers,
        now: () => new Date("2026-07-29T02:37:00.000Z"),
        random: () => 0.5
    });

    assert.deepEqual(
        calls.map((item) => item.jobType),
        ["proactive_message", "profile_refresh"]
    );
    assert.ok(
        calls.every(
            (item) =>
                item.options.reconciliationId === "2026-07-29T02"
        )
    );
    assert.equal(result.seeded, 2);
    assert.equal(result.alreadyActive, 2);
}

async function testDisabledPushDoesNotReseedProactiveChain() {
    const calls = [];
    const schedulers = Object.fromEntries(
        RECURRING_JOB_TYPES.map((jobType) => [
            jobType,
            async () => {
                calls.push(jobType);
                return { scheduled: true };
            }
        ])
    );
    const result = await reconcileTenantRecurringJobs({
        database: { from() {} },
        async getSettings() {
            return { push_enabled: false };
        },
        async listActiveJobs() {
            return [];
        },
        schedulers,
        now: () => new Date("2026-07-29T02:37:00.000Z")
    });

    assert.deepEqual(calls, [
        "moment_post",
        "diary_update",
        "profile_refresh"
    ]);
    assert.equal(result.seeded, 3);
    assert.equal(result.disabled, 1);
}

Promise.resolve()
    .then(testSeedsOnlyMissingRecurringChains)
    .then(testDisabledPushDoesNotReseedProactiveChain)
    .then(() => console.log("background job reconciliation tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
