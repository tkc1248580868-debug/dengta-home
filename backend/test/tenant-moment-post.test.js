const assert = require("node:assert/strict");
const {
    handleTenantMomentPost,
    scheduleMomentPostEvaluation
} = require("../services/tenant-moment-post");
const {
    stableUuid
} = require("../services/tenant-proactive-message");

const JOB_ID = "10000000-0000-4000-8000-000000000011";
const CONVERSATION_ID =
    "20000000-0000-4000-8000-000000000011";

function createDatabase(initial = {}) {
    const tables = {
        conversations: [],
        moments: [],
        background_jobs: [],
        ...structuredClone(initial)
    };

    function from(table) {
        let action = "select";
        let inserted = null;
        const filters = [];
        let orderBy = null;
        let limitCount = null;

        function selectedRows() {
            let rows = tables[table].filter((row) =>
                filters.every(([kind, column, value]) => {
                    if (kind === "eq") return row[column] === value;
                    if (kind === "gte") {
                        return String(row[column] || "") >= String(value);
                    }
                    return true;
                })
            );
            if (orderBy) {
                const [column, options] = orderBy;
                rows = [...rows].sort((left, right) => {
                    const comparison = String(
                        left[column] || ""
                    ).localeCompare(String(right[column] || ""));
                    return options?.ascending === false
                        ? -comparison
                        : comparison;
                });
            }
            return limitCount == null ? rows : rows.slice(0, limitCount);
        }

        async function execute() {
            if (action === "insert") {
                if (
                    table === "background_jobs" &&
                    tables.background_jobs.some(
                        (item) =>
                            item.job_type === inserted.job_type &&
                            item.status === "pending"
                    )
                ) {
                    return { data: null, error: { code: "23505" } };
                }
                if (
                    table === "moments" &&
                    tables.moments.some((item) => item.id === inserted.id)
                ) {
                    return { data: null, error: { code: "23505" } };
                }
                const saved = {
                    id:
                        inserted.id ||
                        `${table}-${tables[table].length + 1}`,
                    status: inserted.status || "pending",
                    created_at:
                        inserted.created_at ||
                        "2026-07-27T06:00:00.000Z",
                    ...inserted
                };
                tables[table].push(saved);
                return { data: saved, error: null };
            }
            return { data: selectedRows(), error: null };
        }

        const builder = {
            select() {
                return builder;
            },
            insert(values) {
                action = "insert";
                inserted = structuredClone(values);
                return builder;
            },
            eq(column, value) {
                filters.push(["eq", column, value]);
                return builder;
            },
            gte(column, value) {
                filters.push(["gte", column, value]);
                return builder;
            },
            order(column, options) {
                orderBy = [column, options];
                return builder;
            },
            limit(value) {
                limitCount = value;
                return builder;
            },
            async maybeSingle() {
                const result = await execute();
                if (result.error || action === "insert") return result;
                return {
                    data: result.data[0] || null,
                    error: null
                };
            },
            then(resolve, reject) {
                return execute().then(resolve, reject);
            }
        };
        return builder;
    }

    return { from, tables };
}

function baseInput(overrides = {}) {
    const database =
        overrides.database ||
        createDatabase({
            conversations: [
                {
                    id: CONVERSATION_ID,
                    updated_at: "2026-07-27T05:50:00.000Z"
                }
            ],
            moments: [
                {
                    id: "30000000-0000-4000-8000-000000000011",
                    author: "user",
                    content: "今天的云很好看。",
                    created_at: "2026-07-27T05:00:00.000Z"
                }
            ]
        });
    let leaseChecks = 0;
    let generatedInput = null;
    const input = {
        job: {
            id: JOB_ID,
            job_type: "moment_post",
            payload: {}
        },
        database,
        lease: {
            async assertOwned() {
                leaseChecks += 1;
            }
        },
        async getSettings() {
            return {
                ai_name: "小灯",
                timezone: "Asia/Shanghai"
            };
        },
        async loadChatContext() {
            return {
                messages: [
                    { role: "user", content: "今天终于忙完了。" },
                    { role: "assistant", content: "那就歇一会儿。" }
                ],
                memories: [{ summary: "桃桃最近一直在赶项目。" }]
            };
        },
        async generateReply(value) {
            generatedInput = value;
            return {
                text:
                    '{"post":true,"content":"忙完的人应该得到一小块安静。今晚先不催你做任何事。","next_check_minutes":180}',
                mode: "api"
            };
        },
        now: () => new Date("2026-07-27T06:00:00.000Z"),
        random: () => 0.5,
        ...overrides
    };
    return {
        input,
        database,
        getState() {
            return { leaseChecks, generatedInput };
        }
    };
}

async function testPostsMomentAndSchedulesNextEvaluation() {
    const { input, database, getState } = baseInput();
    const result = await handleTenantMomentPost(input);
    const momentId = stableUuid("moment-post", JOB_ID);

    assert.deepEqual(result, {
        status: "handled",
        decision: "posted",
        momentId,
        nextCheckMinutes: 180
    });
    const saved = database.tables.moments.find(
        (item) => item.id === momentId
    );
    assert.equal(saved.author, "assistant");
    assert.equal(saved.reply_status, "done");
    assert.deepEqual(saved.images, []);
    assert.equal(database.tables.background_jobs.length, 1);
    assert.equal(
        database.tables.background_jobs[0].job_type,
        "moment_post"
    );
    assert.equal(
        database.tables.background_jobs[0].due_at,
        "2026-07-27T09:00:00.000Z"
    );
    assert.equal(
        getState().generatedInput.promptArchitecture,
        "moment-post-module"
    );
    assert.match(
        getState().generatedInput.runtimeContext,
        /今天的云很好看/
    );
    assert.ok(getState().leaseChecks >= 2);
}

async function testModelMayChooseNotToPost() {
    const { input, database } = baseInput({
        async generateReply() {
            return {
                text:
                    '{"post":false,"content":"","next_check_minutes":420}',
                mode: "api"
            };
        }
    });
    const originalCount = database.tables.moments.length;
    const result = await handleTenantMomentPost(input);

    assert.equal(result.decision, "none");
    assert.equal(result.momentId, null);
    assert.equal(result.nextCheckMinutes, 420);
    assert.equal(database.tables.moments.length, originalCount);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testRetryRecoversDeterministicMoment() {
    const id = stableUuid("moment-post", JOB_ID);
    const database = createDatabase({
        conversations: [
            {
                id: CONVERSATION_ID,
                updated_at: "2026-07-27T05:50:00.000Z"
            }
        ],
        moments: [
            {
                id,
                author: "assistant",
                content: "已经发过的动态。",
                created_at: "2026-07-27T05:55:00.000Z"
            }
        ]
    });
    let generateCalls = 0;
    const { input } = baseInput({
        database,
        async generateReply() {
            generateCalls += 1;
            throw new Error("must not generate twice");
        }
    });

    const result = await handleTenantMomentPost(input);
    assert.equal(result.decision, "recovered");
    assert.equal(result.momentId, id);
    assert.equal(generateCalls, 0);
    assert.equal(database.tables.moments.length, 1);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testChatSeedKeepsOnePendingEvaluation() {
    const database = createDatabase();
    const first = await scheduleMomentPostEvaluation({
        database,
        sourceMessageId: 701,
        now: () => new Date("2026-07-27T06:00:00.000Z"),
        random: () => 0
    });
    const second = await scheduleMomentPostEvaluation({
        database,
        sourceMessageId: 702,
        now: () => new Date("2026-07-27T06:01:00.000Z"),
        random: () => 1
    });

    assert.equal(first.scheduled, true);
    assert.equal(second.scheduled, false);
    assert.equal(second.reason, "already_pending");
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testReconciliationCanRepairAMissingChain() {
    const database = createDatabase();
    const result = await scheduleMomentPostEvaluation({
        database,
        reconciliationId: "2026-07-29T02",
        now: () => new Date("2026-07-29T02:00:00.000Z"),
        random: () => 0
    });
    assert.equal(result.scheduled, true);
    assert.equal(database.tables.background_jobs.length, 1);
    assert.equal(
        database.tables.background_jobs[0].dedupe_key,
        "moment-post:reconciliation:2026-07-29T02"
    );
    assert.deepEqual(database.tables.background_jobs[0].payload, {
        reason: "reconciliation",
        reconciliation_id: "2026-07-29T02"
    });
}

async function testResetCutoffExcludesOldMomentsFromModelContext() {
    const resetAt = "2026-07-27T05:00:00.000Z";
    const oldMomentId =
        "30000000-0000-4000-8000-000000000021";
    const database = createDatabase({
        conversations: [
            {
                id: CONVERSATION_ID,
                updated_at: "2026-07-27T05:50:00.000Z"
            }
        ],
        moments: [
            {
                id: oldMomentId,
                author: "user",
                content: "RESET_BEFORE_MOMENT_POST",
                created_at: "2026-07-27T04:59:59.999Z"
            },
            {
                id: "30000000-0000-4000-8000-000000000022",
                author: "user",
                content: "RESET_BOUNDARY_MOMENT_POST",
                created_at: resetAt
            },
            {
                id: "30000000-0000-4000-8000-000000000023",
                author: "assistant",
                content: "RESET_AFTER_MOMENT_POST",
                created_at: "2026-07-27T05:00:01.000Z"
            }
        ]
    });
    const { input, getState } = baseInput({
        database,
        async getSettings() {
            return {
                ai_name: "小灯",
                timezone: "Asia/Shanghai",
                context_reset_at: resetAt
            };
        }
    });

    await handleTenantMomentPost(input);
    const runtimeContext = getState().generatedInput.runtimeContext;
    assert.doesNotMatch(runtimeContext, /RESET_BEFORE_MOMENT_POST/);
    assert.match(runtimeContext, /RESET_BOUNDARY_MOMENT_POST/);
    assert.match(runtimeContext, /RESET_AFTER_MOMENT_POST/);
    assert.ok(
        database.tables.moments.some((item) => item.id === oldMomentId),
        "reset must not delete historical moments"
    );
}

Promise.resolve()
    .then(testPostsMomentAndSchedulesNextEvaluation)
    .then(testModelMayChooseNotToPost)
    .then(testRetryRecoversDeterministicMoment)
    .then(testChatSeedKeepsOnePendingEvaluation)
    .then(testReconciliationCanRepairAMissingChain)
    .then(testResetCutoffExcludesOldMomentsFromModelContext)
    .then(() => console.log("tenant moment post tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
