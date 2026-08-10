const assert = require("node:assert/strict");
const {
    createTenantMomentContextLoader,
    createTenantMomentInteractionHandler
} = require("../services/tenant-moment-runtime");

const TENANT = Object.freeze({
    userId: "11111111-1111-4111-8111-111111111111",
    companionId: "22222222-2222-4222-8222-222222222222"
});
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

function fakeBlob(bytes, type) {
    return {
        size: bytes.length,
        type,
        async arrayBuffer() {
            return bytes;
        }
    };
}

function createConversationDatabase(conversation) {
    const calls = [];
    return {
        calls,
        from(table) {
            assert.equal(table, "conversations");
            const builder = {
                select(columns) {
                    calls.push(["select", columns]);
                    return builder;
                },
                order(column, options) {
                    calls.push(["order", column, options]);
                    return builder;
                },
                limit(value) {
                    calls.push(["limit", value]);
                    return builder;
                },
                async maybeSingle() {
                    calls.push(["maybeSingle"]);
                    return { data: conversation, error: null };
                }
            };
            return builder;
        }
    };
}

async function testLoadsHintedConversationAndOwnedPrivateImages() {
    const database = createConversationDatabase(null);
    const downloads = [];
    const contexts = [];
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
    const storage = {
        from(bucket) {
            assert.equal(bucket, "moments");
            return {
                async download(storagePath) {
                    downloads.push(storagePath);
                    return {
                        data: fakeBlob(bytes, "image/jpeg"),
                        error: null
                    };
                }
            };
        }
    };
    const loadContext = createTenantMomentContextLoader({
        storage,
        async loadCompanionInteractionContext(
            conversationId,
            settings,
            scopedDatabase
        ) {
            contexts.push({ conversationId, settings, scopedDatabase });
            return {
                messages: [{ role: "user", content: "recent" }],
                memories: [{ summary: "stable" }]
            };
        }
    });

    const settings = {
        context_reset_at: "2026-07-29T02:00:00.000Z"
    };
    const result = await loadContext({
        database,
        settings,
        job: {
            user_id: TENANT.userId,
            companion_id: TENANT.companionId
        },
        moment: {
            context_note: `active_session_id:${SESSION_ID}`,
            images: [
                {
                    storage_path:
                        `${TENANT.userId}/${TENANT.companionId}/2026-07-26/photo.jpg`,
                    mime_type: "image/jpeg",
                    byte_size: bytes.length
                },
                {
                    storage_path:
                        "99999999-9999-4999-8999-999999999999/" +
                        `${TENANT.companionId}/foreign.jpg`,
                    mime_type: "image/jpeg",
                    byte_size: bytes.length
                },
                {
                    storage_path:
                        `${TENANT.userId}/${TENANT.companionId}/../../escape.png`,
                    mime_type: "image/png",
                    byte_size: 4
                }
            ]
        },
        comment: null
    });

    assert.deepEqual(contexts, [
        {
            conversationId: SESSION_ID,
            settings,
            scopedDatabase: database
        }
    ]);
    assert.deepEqual(downloads, [
        `${TENANT.userId}/${TENANT.companionId}/2026-07-26/photo.jpg`
    ]);
    assert.deepEqual(result.messages, [
        { role: "user", content: "recent" }
    ]);
    assert.deepEqual(result.memories, [{ summary: "stable" }]);
    assert.deepEqual(result.attachments, [
        {
            mimeType: "image/jpeg",
            data: bytes.toString("base64")
        }
    ]);
}

async function testFallsBackToLatestScopedConversation() {
    const database = createConversationDatabase({ id: SESSION_ID });
    const calls = [];
    const loader = createTenantMomentContextLoader({
        storage: {
            from() {
                throw new Error("storage should not be read");
            }
        },
        async loadCompanionInteractionContext(
            conversationId,
            _settings,
            scopedDatabase
        ) {
            calls.push({ conversationId, scopedDatabase });
            return { messages: [], memories: [] };
        }
    });

    const result = await loader({
        database,
        job: {
            user_id: TENANT.userId,
            companion_id: TENANT.companionId
        },
        moment: { context_note: "", images: [] }
    });

    assert.deepEqual(calls, [
        { conversationId: SESSION_ID, scopedDatabase: database }
    ]);
    assert.deepEqual(result, {
        messages: [],
        memories: [],
        attachments: []
    });
    assert.equal(
        database.calls.some(
            (entry) =>
                entry[0] === "order" &&
                entry[1] === "updated_at" &&
                entry[2]?.ascending === false
        ),
        true
    );
}

async function testRejectsOversizedOrUnsupportedImageData() {
    const database = createConversationDatabase(null);
    let downloadCalls = 0;
    const loader = createTenantMomentContextLoader({
        storage: {
            from() {
                return {
                    async download() {
                        downloadCalls += 1;
                        return {
                            data: fakeBlob(
                                Buffer.alloc(5 * 1024 * 1024 + 1),
                                "image/png"
                            ),
                            error: null
                        };
                    }
                };
            }
        },
        async loadCompanionInteractionContext() {
            throw new Error("no conversation should be loaded");
        }
    });

    const result = await loader({
        database,
        job: {
            user_id: TENANT.userId,
            companion_id: TENANT.companionId
        },
        moment: {
            context_note: "",
            images: [
                {
                    storage_path:
                        `${TENANT.userId}/${TENANT.companionId}/large.png`,
                    mime_type: "image/png",
                    byte_size: 5 * 1024 * 1024
                },
                {
                    storage_path:
                        `${TENANT.userId}/${TENANT.companionId}/note.svg`,
                    mime_type: "image/svg+xml",
                    byte_size: 10
                }
            ]
        }
    });

    assert.equal(downloadCalls, 1);
    assert.deepEqual(result.attachments, []);
    assert.deepEqual(result.messages, []);
    assert.deepEqual(result.memories, []);
}

async function testHandlerWiresOnlyInjectedTenantServices() {
    const calls = [];
    const generateReply = async () => ({ text: "" });
    const getSettings = async () => ({});
    const lease = { assertOwned: async () => {} };
    const storage = { from() {} };
    const handler = createTenantMomentInteractionHandler({
        storage,
        generateReply,
        getSettings,
        loadCompanionInteractionContext: async () => ({
            messages: [],
            memories: []
        }),
        async handleInteraction(input) {
            calls.push(input);
            return { status: "handled" };
        }
    });
    const database = { from() {} };
    const job = {
        user_id: TENANT.userId,
        companion_id: TENANT.companionId,
        job_type: "moment_interaction",
        payload: {}
    };

    assert.deepEqual(
        await handler({ job, database, lease }),
        { status: "handled" }
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].job, job);
    assert.equal(calls[0].database, database);
    assert.equal(calls[0].generateReply, generateReply);
    assert.equal(calls[0].getSettings, getSettings);
    assert.equal(calls[0].lease, lease);
    assert.equal(typeof calls[0].loadContext, "function");
}

Promise.resolve()
    .then(testLoadsHintedConversationAndOwnedPrivateImages)
    .then(testFallsBackToLatestScopedConversation)
    .then(testRejectsOversizedOrUnsupportedImageData)
    .then(testHandlerWiresOnlyInjectedTenantServices)
    .then(() => console.log("tenant moment runtime tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
