const assert = require("node:assert/strict");

const {
    handleTenantMomentInteraction,
    stableCommentReplyId
} = require("../services/tenant-moment-interaction");

const TENANT_A = Object.freeze({
    userId: "10000000-0000-4000-8000-000000000001",
    companionId: "20000000-0000-4000-8000-000000000001"
});
const TENANT_B = Object.freeze({
    userId: "10000000-0000-4000-8000-000000000002",
    companionId: "20000000-0000-4000-8000-000000000002"
});

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createScopedDatabase(seed, scope = TENANT_A) {
    const tables = clone(seed);
    let sequence = 0;

    function from(tableName) {
        if (!Array.isArray(tables[tableName])) {
            throw new Error(`Unexpected table: ${tableName}`);
        }

        const state = {
            operation: "select",
            values: null,
            filters: [],
            cardinality: "many"
        };

        const builder = {
            select() {
                return builder;
            },
            insert(values) {
                state.operation = "insert";
                state.values = values;
                return builder;
            },
            update(values) {
                state.operation = "update";
                state.values = values;
                return builder;
            },
            eq(column, value) {
                state.filters.push([column, value]);
                return builder;
            },
            single() {
                state.cardinality = "single";
                return builder;
            },
            maybeSingle() {
                state.cardinality = "maybeSingle";
                return builder;
            },
            then(resolve, reject) {
                return Promise.resolve(execute()).then(resolve, reject);
            }
        };

        function inScope(row) {
            return (
                row.user_id === scope.userId &&
                row.companion_id === scope.companionId
            );
        }

        function matches(row) {
            return (
                inScope(row) &&
                state.filters.every(
                    ([column, value]) => row[column] === value
                )
            );
        }

        function result(rows) {
            if (state.cardinality === "single") {
                return rows.length === 1
                    ? { data: clone(rows[0]), error: null }
                    : {
                          data: null,
                          error: Object.assign(
                              new Error("Expected one row"),
                              { code: "PGRST116" }
                          )
                      };
            }
            if (state.cardinality === "maybeSingle") {
                return rows.length <= 1
                    ? { data: clone(rows[0] || null), error: null }
                    : {
                          data: null,
                          error: Object.assign(
                              new Error("Expected zero or one row"),
                              { code: "PGRST116" }
                          )
                      };
            }
            return { data: clone(rows), error: null };
        }

        function execute() {
            let rows = tables[tableName].filter(matches);
            if (state.operation === "update") {
                for (const row of rows) {
                    Object.assign(row, clone(state.values));
                }
                return result(rows);
            }
            if (state.operation === "insert") {
                const values = Array.isArray(state.values)
                    ? state.values
                    : [state.values];
                const inserted = values.map((value) => {
                    sequence += 1;
                    const row = {
                        id:
                            value.id ||
                            `90000000-0000-4000-8000-${String(
                                sequence
                            ).padStart(12, "0")}`,
                        user_id: scope.userId,
                        companion_id: scope.companionId,
                        created_at: "2026-07-26T12:00:00.000Z",
                        ...clone(value)
                    };
                    if (
                        tables[tableName].some(
                            (item) => item.id === row.id
                        )
                    ) {
                        return null;
                    }
                    tables[tableName].push(row);
                    return row;
                });
                if (inserted.includes(null)) {
                    return {
                        data: null,
                        error: Object.assign(
                            new Error("duplicate key"),
                            { code: "23505" }
                        )
                    };
                }
                return result(inserted);
            }
            return result(rows);
        }

        return builder;
    }

    return { from, tables };
}

function momentFixture(overrides = {}) {
    return {
        id: "30000000-0000-4000-8000-000000000001",
        user_id: TENANT_A.userId,
        companion_id: TENANT_A.companionId,
        author: "user",
        content: "今天的云很低。",
        images: [],
        image_description: null,
        context_note: null,
        liked: false,
        reply_content: null,
        reply_status: "pending",
        created_at: "2026-07-26T11:00:00.000Z",
        ...overrides
    };
}

function interactionJob(payload = {}) {
    return {
        id: "40000000-0000-4000-8000-000000000001",
        job_type: "moment_interaction",
        payload: {
            moment_id: "30000000-0000-4000-8000-000000000001",
            ...payload
        }
    };
}

function userCommentFixture(overrides = {}) {
    return {
        id: "50000000-0000-4000-8000-000000000001",
        user_id: TENANT_A.userId,
        companion_id: TENANT_A.companionId,
        moment_id: "30000000-0000-4000-8000-000000000001",
        author: "user",
        content: "你也看到那朵像小熊的云了吗？",
        reply_status: "pending",
        created_at: "2026-07-26T11:30:00.000Z",
        ...overrides
    };
}

function servicesFor(text, overrides = {}) {
    return {
        lease: {
            async assertOwned() {}
        },
        async getSettings() {
            return { model: "test-model", max_tokens: 300 };
        },
        async loadContext() {
            return {
                messages: [],
                memories: [],
                runtimeContext: {}
            };
        },
        async generateReply() {
            return { text, mode: "api" };
        },
        now: () => Date.parse("2026-07-26T12:00:00.000Z"),
        ...overrides
    };
}

async function testLikeDecision() {
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: []
    });

    const result = await handleTenantMomentInteraction({
        job: interactionJob(),
        database,
        ...servicesFor('{"like":true,"comment":""}')
    });

    assert.deepEqual(result, {
        status: "handled",
        decision: "like",
        momentId: "30000000-0000-4000-8000-000000000001",
        commentId: null,
        liked: true,
        commented: false
    });
    assert.equal(database.tables.moments[0].liked, true);
    assert.equal(database.tables.moments[0].reply_content, null);
    assert.equal(database.tables.moments[0].reply_status, "done");
    assert.equal(
        database.tables.moments[0].replied_at,
        "2026-07-26T12:00:00.000Z"
    );
}

async function testCommentDecisionSeesMomentContent() {
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: []
    });
    let generatedInput = null;

    const result = await handleTenantMomentInteraction({
        job: interactionJob(),
        database,
        ...servicesFor('{"like":false,"comment":"我也看见了。"}', {
            async generateReply(input) {
                generatedInput = input;
                return {
                    text: '{"like":false,"comment":"我也看见了。"}',
                    mode: "api"
                };
            }
        })
    });

    assert.equal(result.decision, "comment");
    assert.equal(result.liked, false);
    assert.equal(result.commented, true);
    assert.equal(
        database.tables.moments[0].reply_content,
        "我也看见了。"
    );
    assert.match(
        generatedInput.messages.at(-1).content,
        /今天的云很低。/,
        "the model must receive the current tenant moment"
    );
    assert.equal(
        generatedInput.promptArchitecture,
        "moment-module",
        "moment jobs must use the independent short module prompt"
    );
}

async function testCommentJobCanLikeAndReply() {
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: [userCommentFixture()]
    });
    let generatedInput = null;
    let ownershipChecks = 0;

    const result = await handleTenantMomentInteraction({
        job: interactionJob({
            comment_id: "50000000-0000-4000-8000-000000000001"
        }),
        database,
        ...servicesFor('{"like":true,"comment":"看到了，耳朵还歪了一点。"}', {
            lease: {
                async assertOwned() {
                    ownershipChecks += 1;
                }
            },
            async generateReply(input) {
                generatedInput = input;
                return {
                    text: '{"like":true,"comment":"看到了，耳朵还歪了一点。"}',
                    mode: "api"
                };
            }
        })
    });

    assert.equal(result.decision, "both");
    assert.equal(database.tables.moments[0].liked, true);
    assert.equal(database.tables.moments[0].reply_content, null);
    assert.equal(database.tables.moments[0].reply_status, "pending");
    assert.equal(database.tables.moment_comments.length, 2);
    assert.deepEqual(
        database.tables.moment_comments.map((comment) => ({
            author: comment.author,
            content: comment.content,
            reply_status: comment.reply_status
        })),
        [
            {
                author: "user",
                content: "你也看到那朵像小熊的云了吗？",
                reply_status: "done"
            },
            {
                author: "assistant",
                content: "看到了，耳朵还歪了一点。",
                reply_status: "none"
            }
        ]
    );
    assert.match(
        generatedInput.messages.at(-1).content,
        /你也看到那朵像小熊的云了吗？/
    );
    assert.equal(
        ownershipChecks,
        3,
        "like, reply insert, and source completion each need an owned lease"
    );
}

async function testModelMayChooseNoInteractionOrReturnNoOutput() {
    for (const generated of [
        { text: '{"like":false,"comment":""}', mode: "api" },
        { text: "   ", mode: "api" },
        { text: "", mode: "placeholder" }
    ]) {
        const database = createScopedDatabase({
            moments: [momentFixture()],
            moment_comments: []
        });

        const result = await handleTenantMomentInteraction({
            job: interactionJob(),
            database,
            ...servicesFor("", {
                async generateReply() {
                    return generated;
                }
            })
        });

        assert.equal(result.decision, "none");
        assert.equal(result.liked, false);
        assert.equal(result.commented, false);
        assert.equal(database.tables.moments[0].liked, false);
        assert.equal(database.tables.moments[0].reply_content, null);
        assert.equal(database.tables.moments[0].reply_status, "done");
    }
}

async function testCrossTenantMomentIsNotReadable() {
    const otherMomentId =
        "30000000-0000-4000-8000-000000000002";
    const database = createScopedDatabase({
        moments: [
            momentFixture({
                id: otherMomentId,
                user_id: TENANT_B.userId,
                companion_id: TENANT_B.companionId,
                content: "另一位用户的私密动态"
            })
        ],
        moment_comments: []
    });
    let generateCalls = 0;

    const result = await handleTenantMomentInteraction({
        job: interactionJob({ moment_id: otherMomentId }),
        database,
        ...servicesFor('{"like":true,"comment":"不应该发生"}', {
            async generateReply() {
                generateCalls += 1;
                return {
                    text: '{"like":true,"comment":"不应该发生"}',
                    mode: "api"
                };
            }
        })
    });

    assert.deepEqual(result, {
        status: "skipped",
        reason: "moment_not_found",
        momentId: otherMomentId,
        commentId: null
    });
    assert.equal(generateCalls, 0);
    assert.equal(database.tables.moments[0].liked, false);
    assert.equal(database.tables.moments[0].reply_status, "pending");
}

async function testRepeatedCommentJobDoesNotDuplicateReply() {
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: [userCommentFixture()]
    });
    let generateCalls = 0;
    const input = {
        job: interactionJob({
            comment_id: "50000000-0000-4000-8000-000000000001"
        }),
        database,
        ...servicesFor('{"like":false,"comment":"只回复一次。"}', {
            async generateReply() {
                generateCalls += 1;
                return {
                    text: '{"like":false,"comment":"只回复一次。"}',
                    mode: "api"
                };
            }
        })
    };

    const first = await handleTenantMomentInteraction(input);
    const repeated = await handleTenantMomentInteraction(input);

    assert.equal(first.status, "handled");
    assert.deepEqual(repeated, {
        status: "skipped",
        reason: "already_handled",
        momentId: "30000000-0000-4000-8000-000000000001",
        commentId: "50000000-0000-4000-8000-000000000001"
    });
    assert.equal(generateCalls, 1);
    assert.equal(
        database.tables.moment_comments.filter(
            (comment) => comment.author === "assistant"
        ).length,
        1
    );
}

async function testRetryReconcilesReplySavedBeforeSourceCompletion() {
    const momentId = "30000000-0000-4000-8000-000000000001";
    const commentId =
        "50000000-0000-4000-8000-000000000001";
    const replyId = stableCommentReplyId(momentId, commentId);
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: [
            userCommentFixture(),
            {
                id: replyId,
                user_id: TENANT_A.userId,
                companion_id: TENANT_A.companionId,
                moment_id: momentId,
                author: "assistant",
                content: "断点前已经保存的回复。",
                reply_status: "none",
                created_at: "2026-07-26T11:31:00.000Z"
            }
        ]
    });

    const result = await handleTenantMomentInteraction({
        job: interactionJob({ comment_id: commentId }),
        database,
        ...servicesFor(
            '{"like":false,"comment":"断点前已经保存的回复。"}'
        )
    });

    assert.equal(result.status, "handled");
    assert.equal(
        database.tables.moment_comments.filter(
            (comment) =>
                comment.author === "assistant" &&
                comment.id === replyId
        ).length,
        1
    );
    assert.equal(
        database.tables.moment_comments.find(
            (comment) => comment.id === commentId
        ).reply_status,
        "done"
    );
}

async function testGenerationErrorLeavesCandidatePendingForWorkerRetry() {
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: []
    });
    const providerError = Object.assign(
        new Error("provider unavailable"),
        { code: "provider_unavailable" }
    );

    await assert.rejects(
        handleTenantMomentInteraction({
            job: interactionJob(),
            database,
            ...servicesFor("", {
                async generateReply() {
                    throw providerError;
                }
            })
        }),
        (error) => error === providerError
    );
    assert.equal(database.tables.moments[0].liked, false);
    assert.equal(database.tables.moments[0].reply_content, null);
    assert.equal(database.tables.moments[0].reply_status, "pending");
}

async function testInvalidJobIsRejectedBeforeDatabaseAccess() {
    let databaseReads = 0;
    const database = {
        from() {
            databaseReads += 1;
            throw new Error("database should not be reached");
        }
    };

    await assert.rejects(
        handleTenantMomentInteraction({
            job: {
                job_type: "moment_post",
                payload: {
                    moment_id:
                        "30000000-0000-4000-8000-000000000001"
                }
            },
            database,
            ...servicesFor("")
        }),
        (error) => error.code === "invalid_moment_interaction_job"
    );
    await assert.rejects(
        handleTenantMomentInteraction({
            job: {
                job_type: "moment_interaction",
                payload: {}
            },
            database,
            ...servicesFor("")
        }),
        (error) => error.code === "invalid_moment_id"
    );
    assert.equal(databaseReads, 0);
}

async function testPrivateImageAttachmentsReachOnlyTheModelTransport() {
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: []
    });
    const jpegData = Buffer.from("private jpeg bytes").toString(
        "base64"
    );
    const pngData = Buffer.from("private png bytes").toString(
        "base64"
    );
    let generatedInput = null;

    await handleTenantMomentInteraction({
        job: interactionJob(),
        database,
        ...servicesFor('{"like":false,"comment":""}', {
            async loadContext() {
                return {
                    messages: [],
                    memories: [],
                    runtimeContext: {},
                    attachments: [
                        {
                            mimeType: "image/jpeg",
                            data: jpegData
                        },
                        {
                            mimeType: "IMAGE/PNG",
                            data: `\n${pngData}\n`
                        }
                    ]
                };
            },
            async generateReply(input) {
                generatedInput = input;
                return {
                    text: '{"like":false,"comment":""}',
                    mode: "api"
                };
            }
        })
    });

    assert.deepEqual(generatedInput.attachments, [
        {
            mimeType: "image/jpeg",
            data: jpegData
        },
        {
            mimeType: "image/png",
            data: pngData
        }
    ]);
    const serializedPrompt = JSON.stringify(
        generatedInput.messages
    );
    assert.equal(serializedPrompt.includes(jpegData), false);
    assert.equal(serializedPrompt.includes(pngData), false);
}

async function testUnsafeOrOversizedAttachmentsAreIgnored() {
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: []
    });
    const validData = Buffer.from("valid image").toString("base64");
    const oversizedData = Buffer.alloc(
        5 * 1024 * 1024 + 1
    ).toString("base64");
    let generatedInput = null;

    await handleTenantMomentInteraction({
        job: interactionJob(),
        database,
        ...servicesFor('{"like":false,"comment":""}', {
            async loadContext() {
                return {
                    attachments: [
                        "https://example.invalid/private.jpg",
                        {
                            mimeType: "image/jpeg",
                            data: "https://example.invalid/private.jpg"
                        },
                        {
                            mimeType: "image/svg+xml",
                            data: validData
                        },
                        {
                            mimeType: "image/png",
                            data: ""
                        },
                        {
                            mimeType: "image/webp",
                            data: "not-base64!"
                        },
                        {
                            mimeType: "image/gif",
                            data: oversizedData
                        },
                        {
                            mimeType: "image/jpeg",
                            data: validData,
                            url: "https://example.invalid/also-present"
                        },
                        ...[
                            "image/jpeg",
                            "image/png",
                            "image/webp",
                            "image/gif",
                            "image/jpeg"
                        ].map((mimeType) => ({
                            mimeType,
                            data: validData
                        }))
                    ]
                };
            },
            async generateReply(input) {
                generatedInput = input;
                return {
                    text: '{"like":false,"comment":""}',
                    mode: "api"
                };
            }
        })
    });

    assert.deepEqual(
        generatedInput.attachments.map((item) => item.mimeType),
        ["image/jpeg", "image/png", "image/webp", "image/gif"]
    );
    assert.equal(
        generatedInput.attachments.every(
            (item) => item.data === validData
        ),
        true
    );
    assert.equal(
        JSON.stringify(generatedInput.messages).includes(
            oversizedData.slice(0, 100)
        ),
        false
    );
}

async function testLeaseIsRequiredAndLossPreventsEveryWrite() {
    const database = createScopedDatabase({
        moments: [momentFixture()],
        moment_comments: [userCommentFixture()]
    });
    const missingLeaseServices = servicesFor(
        '{"like":true,"comment":"不会写入"}'
    );
    delete missingLeaseServices.lease;

    await assert.rejects(
        handleTenantMomentInteraction({
            job: interactionJob({
                comment_id:
                    "50000000-0000-4000-8000-000000000001"
            }),
            database,
            ...missingLeaseServices
        }),
        (error) => error.code === "missing_moment_interaction_lease"
    );

    const leaseLost = Object.assign(new Error("lease lost"), {
        code: "background_job_lease_lost"
    });
    let ownershipChecks = 0;
    await assert.rejects(
        handleTenantMomentInteraction({
            job: interactionJob({
                comment_id:
                    "50000000-0000-4000-8000-000000000001"
            }),
            database,
            ...servicesFor(
                '{"like":true,"comment":"也不会写入"}',
                {
                    lease: {
                        async assertOwned() {
                            ownershipChecks += 1;
                            throw leaseLost;
                        }
                    }
                }
            )
        }),
        (error) => error === leaseLost
    );

    assert.equal(ownershipChecks, 1);
    assert.equal(database.tables.moments[0].liked, false);
    assert.equal(database.tables.moments[0].reply_content, null);
    assert.equal(database.tables.moments[0].reply_status, "pending");
    assert.equal(database.tables.moment_comments.length, 1);
    assert.equal(
        database.tables.moment_comments[0].reply_status,
        "pending"
    );
}

Promise.resolve()
    .then(testLikeDecision)
    .then(testCommentDecisionSeesMomentContent)
    .then(testCommentJobCanLikeAndReply)
    .then(testModelMayChooseNoInteractionOrReturnNoOutput)
    .then(testCrossTenantMomentIsNotReadable)
    .then(testRepeatedCommentJobDoesNotDuplicateReply)
    .then(testRetryReconcilesReplySavedBeforeSourceCompletion)
    .then(testGenerationErrorLeavesCandidatePendingForWorkerRetry)
    .then(testInvalidJobIsRejectedBeforeDatabaseAccess)
    .then(testPrivateImageAttachmentsReachOnlyTheModelTransport)
    .then(testUnsafeOrOversizedAttachmentsAreIgnored)
    .then(testLeaseIsRequiredAndLossPreventsEveryWrite)
    .then(() => {
        console.log("tenant moment interaction tests passed");
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
