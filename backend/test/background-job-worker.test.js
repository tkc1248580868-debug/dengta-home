const assert = require("node:assert/strict");
const {
    createBackgroundJobLeaseHeartbeat,
    createBackgroundJobWorker
} = require("../services/background-job-worker");

const TENANTS = Object.freeze({
    alpha: Object.freeze({
        userId: "11111111-1111-4111-8111-111111111111",
        companionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }),
    beta: Object.freeze({
        userId: "22222222-2222-4222-8222-222222222222",
        companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    }),
    empty: Object.freeze({
        userId: "33333333-3333-4333-8333-333333333333",
        companionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    }),
    archived: Object.freeze({
        userId: "44444444-4444-4444-8444-444444444444",
        companionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    })
});

const SECRET_PAYLOAD = "private-message-body-that-must-never-be-logged";
const SECRET_KEY = "fixture-secret-value-that-must-never-be-logged";
const SECRET_ERROR =
    "provider failed while using fixture-secret-value";

function job({ id, tenant, type, payload = {} }) {
    return {
        id,
        user_id: tenant.userId,
        companion_id: tenant.companionId,
        job_type: type,
        lease_id: `lease-${id}`,
        payload
    };
}

function createFakeAdmin({ companions, jobs, renewResult = true }) {
    const calls = [];
    const states = new Map(jobs.map((item) => [item.id, "pending"]));

    return {
        calls,
        states,
        from(table) {
            assert.equal(table, "companions");
            let selected = "";
            let status = "";
            const orders = [];
            return {
                select(columns) {
                    selected = columns;
                    return this;
                },
                eq(column, value) {
                    assert.equal(column, "status");
                    status = value;
                    return this;
                },
                order(column, options) {
                    orders.push({ column, options });
                    return this;
                },
                async range(from, to) {
                    calls.push({
                        kind: "query",
                        table,
                        selected,
                        status,
                        orders,
                        from,
                        to
                    });
                    const rows = companions
                        .filter((item) => item.status === status)
                        .slice(from, to + 1)
                        .map((item) => ({
                            user_id: item.userId,
                            id: item.companionId
                        }));
                    return { data: rows, error: null };
                }
            };
        },
        async rpc(name, params) {
            calls.push({ kind: "rpc", name, params: { ...params } });
            if (name === "claim_background_jobs") {
                const claimed = jobs.filter(
                    (item) =>
                        item.user_id === params.p_user_id &&
                        item.companion_id === params.p_companion_id &&
                        states.get(item.id) === "pending"
                );
                for (const item of claimed.slice(0, params.p_limit)) {
                    states.set(item.id, "running");
                }
                return {
                    data: claimed.slice(0, params.p_limit),
                    error: null
                };
            }

            const state = states.get(params.p_job_id);
            if (name === "renew_background_job_lease") {
                return {
                    data: state === "running" && renewResult,
                    error: null
                };
            }
            if (name === "complete_background_job") {
                if (state !== "running") {
                    return { data: false, error: null };
                }
                states.set(params.p_job_id, "completed");
                return { data: true, error: null };
            }
            if (name === "fail_background_job") {
                if (state !== "running") {
                    return { data: { updated: false }, error: null };
                }
                states.set(params.p_job_id, "failed");
                return {
                    data: {
                        updated: true,
                        status:
                            params.p_max_attempts === 1 ? "failed" : "pending"
                    },
                    error: null
                };
            }
            throw new Error(`Unexpected RPC ${name}`);
        }
    };
}

function createLogCapture() {
    const entries = [];
    const logger = {};
    for (const level of ["info", "warn", "error", "log"]) {
        logger[level] = (...args) => entries.push({ level, args });
    }
    return { entries, logger };
}

async function testWorkerRun() {
    const jobs = [
        job({
            id: "job-alpha-1",
            tenant: TENANTS.alpha,
            type: "proactive_message",
            payload: { content: SECRET_PAYLOAD, api_key: SECRET_KEY }
        }),
        job({
            id: "job-alpha-2",
            tenant: TENANTS.alpha,
            type: "proactive_message"
        }),
        job({
            id: "job-beta-failure",
            tenant: TENANTS.beta,
            type: "moment_interaction"
        }),
        job({
            id: "job-beta-unknown",
            tenant: TENANTS.beta,
            type: "diary_update"
        }),
        job({
            id: "job-archived",
            tenant: TENANTS.archived,
            type: "proactive_message"
        })
    ];
    const admin = createFakeAdmin({
        companions: [
            { ...TENANTS.alpha, status: "active" },
            { ...TENANTS.beta, status: "active" },
            { ...TENANTS.empty, status: "active" },
            { ...TENANTS.archived, status: "archived" }
        ],
        jobs
    });
    const { entries, logger } = createLogCapture();
    const handled = [];
    const databaseScopes = [];
    let activeHandlers = 0;
    let maximumActiveHandlers = 0;

    const worker = createBackgroundJobWorker({
        adminSupabase: admin,
        workerId: "worker-test-1",
        concurrency: 2,
        claimLimit: 10,
        leaseSeconds: 30,
        heartbeatIntervalMs: 2,
        companionPageSize: 2,
        logger,
        createTenantDatabase({ adminSupabase, tenant }) {
            assert.equal(adminSupabase, admin);
            const database = Object.freeze({
                tenant,
                from() {
                    throw new Error("not used in this worker unit test");
                }
            });
            databaseScopes.push(database);
            return database;
        },
        handlers: {
            async proactive_message(context) {
                assert.notEqual(context.database, admin);
                assert.equal(context.database.tenant, context.tenant);
                assert.equal(
                    context.tenant.userId,
                    context.job.user_id,
                    "handler tenant must match the claimed job"
                );
                assert.equal(
                    context.tenant.companionId,
                    context.job.companion_id,
                    "handler companion must match the claimed job"
                );
                assert.equal(typeof context.lease.assertOwned, "function");
                handled.push({
                    id: context.job.id,
                    tenant: context.tenant
                });
                activeHandlers += 1;
                maximumActiveHandlers = Math.max(
                    maximumActiveHandlers,
                    activeHandlers
                );
                await new Promise((resolve) => setTimeout(resolve, 8));
                activeHandlers -= 1;
            },
            async moment_interaction(context) {
                handled.push({
                    id: context.job.id,
                    tenant: context.tenant
                });
                activeHandlers += 1;
                maximumActiveHandlers = Math.max(
                    maximumActiveHandlers,
                    activeHandlers
                );
                await new Promise((resolve) => setTimeout(resolve, 5));
                activeHandlers -= 1;
                throw new Error(SECRET_ERROR);
            }
        }
    });

    assert.equal(worker.workerId, "worker-test-1");
    const firstRun = worker.runOnce();
    const coalescedRun = worker.runOnce();
    assert.equal(
        firstRun,
        coalescedRun,
        "overlapping runOnce calls must share one execution"
    );
    const stats = await firstRun;

    assert.deepEqual(stats, {
        companions: 3,
        claimed: 4,
        completed: 2,
        failed: 2,
        leaseLost: 0,
        errors: 0,
        unknownTypes: 1,
        reconciled: 0,
        reseeded: 0,
        reconcileErrors: 0
    });
    assert.equal(handled.length, 3);
    assert.equal(databaseScopes.length, 3);
    const alphaDatabases = databaseScopes.filter(
        (database) => database.tenant.userId === TENANTS.alpha.userId
    );
    const betaDatabases = databaseScopes.filter(
        (database) => database.tenant.userId === TENANTS.beta.userId
    );
    assert.ok(alphaDatabases.length > 0);
    assert.ok(betaDatabases.length > 0);
    for (const alphaDatabase of alphaDatabases) {
        for (const betaDatabase of betaDatabases) {
            assert.notEqual(
                alphaDatabase,
                betaDatabase,
                "different tenants must receive different database scopes"
            );
        }
    }
    assert.ok(maximumActiveHandlers > 1);
    assert.ok(maximumActiveHandlers <= 2);
    assert.equal(
        handled.some((item) => item.id === "job-archived"),
        false,
        "archived companions must never be claimed"
    );

    const rpcCalls = admin.calls.filter((item) => item.kind === "rpc");
    const claimCalls = rpcCalls.filter(
        (item) => item.name === "claim_background_jobs"
    );
    assert.equal(claimCalls.length, 3);
    assert.deepEqual(
        claimCalls.map((item) => ({
            userId: item.params.p_user_id,
            companionId: item.params.p_companion_id
        })),
        [TENANTS.alpha, TENANTS.beta, TENANTS.empty]
    );
    for (const call of claimCalls) {
        assert.equal(call.params.p_worker_id, "worker-test-1");
        assert.equal(call.params.p_limit, 10);
        assert.equal(call.params.p_lease_seconds, 30);
        assert.equal(call.params.p_max_attempts, 5);
    }

    const byJobId = new Map(jobs.map((item) => [item.id, item]));
    for (const call of rpcCalls.filter((item) => item.params.p_job_id)) {
        const expectedJob = byJobId.get(call.params.p_job_id);
        assert.equal(call.params.p_user_id, expectedJob.user_id);
        assert.equal(call.params.p_companion_id, expectedJob.companion_id);
        assert.equal(call.params.p_lease_id, expectedJob.lease_id);
        assert.equal(call.params.p_worker_id, "worker-test-1");
    }

    const renewCalls = rpcCalls.filter(
        (item) => item.name === "renew_background_job_lease"
    );
    assert.ok(
        renewCalls.length > stats.claimed,
        "long-running handlers must receive periodic lease heartbeats"
    );
    for (const call of renewCalls) {
        assert.equal(call.params.p_lease_seconds, 30);
    }

    const completionCalls = rpcCalls.filter(
        (item) => item.name === "complete_background_job"
    );
    assert.deepEqual(
        completionCalls.map((item) => item.params.p_job_id).sort(),
        ["job-alpha-1", "job-alpha-2"]
    );

    const failureCalls = rpcCalls.filter(
        (item) => item.name === "fail_background_job"
    );
    assert.equal(failureCalls.length, 2);
    const handlerFailure = failureCalls.find(
        (item) => item.params.p_job_id === "job-beta-failure"
    );
    assert.equal(handlerFailure.params.p_error_code, "handler_failed");
    assert.equal(handlerFailure.params.p_max_attempts, 5);
    assert.equal(handlerFailure.params.p_base_retry_seconds, 30);
    assert.equal(handlerFailure.params.p_max_retry_seconds, 3600);
    const unknownFailure = failureCalls.find(
        (item) => item.params.p_job_id === "job-beta-unknown"
    );
    assert.equal(unknownFailure.params.p_error_code, "unknown_job_type");
    assert.equal(
        unknownFailure.params.p_max_attempts,
        1,
        "unknown job types must fail permanently"
    );

    const secondStats = await worker.runOnce();
    assert.equal(secondStats.claimed, 0);
    assert.equal(handled.length, 3, "completed jobs must not run twice");

    const serializedLogs = JSON.stringify(entries);
    assert.doesNotMatch(serializedLogs, new RegExp(SECRET_PAYLOAD));
    assert.doesNotMatch(serializedLogs, new RegExp(SECRET_KEY));
    assert.doesNotMatch(serializedLogs, /provider failed while using/i);
    assert.doesNotMatch(serializedLogs, /payload/i);
    assert.doesNotMatch(serializedLogs, /api_key/i);
}

async function testLeaseLossDoesNotComplete() {
    const claimedJob = job({
        id: "job-lost-lease",
        tenant: TENANTS.alpha,
        type: "proactive_message"
    });
    const admin = createFakeAdmin({
        companions: [{ ...TENANTS.alpha, status: "active" }],
        jobs: [claimedJob],
        renewResult: false
    });
    let handlerCalls = 0;
    const worker = createBackgroundJobWorker({
        adminSupabase: admin,
        workerId: "worker-lost-lease",
        leaseSeconds: 30,
        heartbeatIntervalMs: 1000,
        logger: createLogCapture().logger,
        createTenantDatabase({ tenant }) {
            return {
                tenant,
                from() {
                    throw new Error("not used");
                }
            };
        },
        handlers: {
            async proactive_message() {
                handlerCalls += 1;
            }
        }
    });

    const stats = await worker.runOnce();
    assert.equal(handlerCalls, 1);
    assert.equal(stats.completed, 0);
    assert.equal(stats.leaseLost, 1);
    assert.equal(
        admin.calls.some(
            (item) =>
                item.kind === "rpc" &&
                item.name === "complete_background_job"
        ),
        false
    );
}

async function testGlobalAdminCannotReachHandler() {
    const claimedJob = job({
        id: "job-invalid-database-scope",
        tenant: TENANTS.alpha,
        type: "proactive_message"
    });
    const admin = createFakeAdmin({
        companions: [{ ...TENANTS.alpha, status: "active" }],
        jobs: [claimedJob]
    });
    let handlerCalls = 0;

    assert.throws(
        () =>
            createBackgroundJobWorker({
                adminSupabase: admin,
                handlers: {}
            }),
        /createTenantDatabase must be a function/
    );

    const worker = createBackgroundJobWorker({
        adminSupabase: admin,
        workerId: "worker-invalid-scope",
        leaseSeconds: 30,
        logger: createLogCapture().logger,
        createTenantDatabase() {
            return admin;
        },
        handlers: {
            async proactive_message() {
                handlerCalls += 1;
            }
        }
    });
    const stats = await worker.runOnce();

    assert.equal(handlerCalls, 0);
    assert.equal(stats.failed, 1);
    const failureCall = admin.calls.find(
        (item) =>
            item.kind === "rpc" && item.name === "fail_background_job"
    );
    assert.equal(
        failureCall.params.p_error_code,
        "tenant_database_invalid"
    );
}

async function testHeartbeatSerializationAndError() {
    const callbacks = [];
    const cleared = [];
    let renewCalls = 0;
    const heartbeat = createBackgroundJobLeaseHeartbeat({
        intervalMs: 10,
        renew: async () => {
            renewCalls += 1;
            return true;
        },
        setIntervalFn(callback) {
            callbacks.push(callback);
            return { unref() {} };
        },
        clearIntervalFn(timer) {
            cleared.push(timer);
        }
    });

    callbacks[0]();
    await heartbeat.assertOwned();
    assert.equal(
        renewCalls,
        1,
        "an ownership check must share an already queued heartbeat"
    );
    await heartbeat.assertOwned();
    assert.equal(renewCalls, 2);
    assert.equal(heartbeat.isLost(), false);
    await heartbeat.stop();
    assert.equal(cleared.length, 1);

    const lostHeartbeat = createBackgroundJobLeaseHeartbeat({
        intervalMs: 10,
        renew: async () => false,
        setIntervalFn() {
            return {};
        },
        clearIntervalFn() {}
    });
    await assert.rejects(
        lostHeartbeat.assertOwned(),
        (error) => error.code === "background_job_lease_lost"
    );
    await lostHeartbeat.stop();
}

async function testRecurringReconciliationInterval() {
    const admin = createFakeAdmin({
        companions: [{ ...TENANTS.alpha, status: "active" }],
        jobs: []
    });
    let currentTime = new Date("2026-07-29T02:00:00.000Z");
    const reconciled = [];
    const worker = createBackgroundJobWorker({
        adminSupabase: admin,
        workerId: "worker-reconciliation",
        reconcileIntervalMs: 60_000,
        now: () => currentTime,
        logger: createLogCapture().logger,
        createTenantDatabase({ tenant }) {
            return {
                tenant,
                from() {
                    throw new Error("not used by the injected reconciler");
                }
            };
        },
        async reconcileTenant({ tenant, database }) {
            reconciled.push({ tenant, database });
            return { seeded: 2 };
        },
        handlers: {}
    });

    const first = await worker.runOnce();
    assert.equal(first.reconciled, 1);
    assert.equal(first.reseeded, 2);
    assert.equal(first.reconcileErrors, 0);
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0].tenant.userId, TENANTS.alpha.userId);

    const second = await worker.runOnce();
    assert.equal(second.reconciled, 0);
    assert.equal(reconciled.length, 1);

    currentTime = new Date(currentTime.getTime() + 60_000);
    const third = await worker.runOnce();
    assert.equal(third.reconciled, 1);
    assert.equal(third.reseeded, 2);
    assert.equal(reconciled.length, 2);
}

Promise.resolve()
    .then(testWorkerRun)
    .then(testLeaseLossDoesNotComplete)
    .then(testGlobalAdminCannotReachHandler)
    .then(testHeartbeatSerializationAndError)
    .then(testRecurringReconciliationInterval)
    .then(() => console.log("background job worker tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
