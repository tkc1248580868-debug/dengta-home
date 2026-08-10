const assert = require("node:assert/strict");
const {
    assertClientMessageConversation,
    chatGenerationInProgressError,
    createChatGenerationLeaseHeartbeat,
    createChatGenerationLeaseStore,
    createClientMessageQueue,
    generationLeaseFields,
    isClientMessageUniqueConflict,
    normalizeClientMessageId,
    shouldResumeClientMessageGeneration
} = require("../services/chat-idempotency");

const MESSAGE_ID = "E65C9B6B-736B-4F39-9A4F-C6F428D49025";
const TENANT = Object.freeze({
    userId: "11111111-1111-4111-8111-111111111111",
    companionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
});
const OTHER_TENANT = Object.freeze({
    userId: "22222222-2222-4222-8222-222222222222",
    companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
});

assert.equal(normalizeClientMessageId(""), "");
assert.equal(
    normalizeClientMessageId(`  ${MESSAGE_ID}  `),
    MESSAGE_ID.toLowerCase()
);
assert.throws(
    () => normalizeClientMessageId("not-a-uuid"),
    (error) => error.status === 400 && error.code === "INVALID_CLIENT_MESSAGE_ID"
);

const NOW = Date.parse("2026-07-21T12:00:00.000Z");
const LEASE_ID = "6a3c28bf-9fe1-41c9-8dad-f8e6f8218d28";
assert.deepEqual(generationLeaseFields(LEASE_ID, NOW, 600), {
    chat_generation_state: "in_progress",
    chat_generation_lease_id: LEASE_ID,
    chat_generation_lease_expires_at: "2026-07-21T12:10:00.000Z",
    chat_generation_started_at: "2026-07-21T12:00:00.000Z",
    chat_generation_failed_at: null,
    chat_generation_completed_at: null
});
assert.equal(
    shouldResumeClientMessageGeneration(
        {
            chat_generation_state: "in_progress",
            chat_generation_lease_expires_at: "2026-07-21T12:09:30.000Z"
        },
        NOW
    ),
    false
);
assert.equal(
    shouldResumeClientMessageGeneration(
        {
            chat_generation_state: "failed",
            chat_generation_started_at: "2026-07-21T11:59:30.000Z"
        },
        NOW
    ),
    true
);
assert.equal(
    shouldResumeClientMessageGeneration(
        {
            chat_generation_state: "in_progress",
            chat_generation_lease_expires_at: "2026-07-21T11:59:59.000Z"
        },
        NOW
    ),
    true
);
assert.equal(
    shouldResumeClientMessageGeneration(
        { chat_generation_state: "completed" },
        NOW
    ),
    false
);

assert.equal(
    chatGenerationInProgressError().code,
    "CHAT_GENERATION_IN_PROGRESS"
);

assert.equal(
    isClientMessageUniqueConflict({
        code: "23505",
        details: "Key (client_message_id) already exists."
    }),
    true
);
assert.equal(
    isClientMessageUniqueConflict({ code: "23505", details: "Key (id) exists." }),
    false
);

assert.doesNotThrow(() =>
    assertClientMessageConversation({ conversation_id: "session-a" }, "session-a")
);
assert.throws(
    () =>
        assertClientMessageConversation(
            { conversation_id: "session-a" },
            "session-b"
        ),
    (error) =>
        error.status === 409 &&
        error.code === "CLIENT_MESSAGE_CONVERSATION_CONFLICT"
);

async function runQueueTests() {
    const runQueued = createClientMessageQueue();
    const order = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
        releaseFirst = resolve;
    });
    const first = runQueued("same-id", async () => {
        order.push("first:start");
        await firstGate;
        order.push("first:end");
        return "first";
    });
    const second = runQueued("same-id", async () => {
        order.push("second:start");
        return "second";
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["first:start"]);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
    assert.deepEqual(order, ["first:start", "first:end", "second:start"]);

    const tenantOrder = [];
    let releaseTenantA;
    const tenantAGate = new Promise((resolve) => {
        releaseTenantA = resolve;
    });
    const tenantA = runQueued(
        "same-id-across-tenants",
        async () => {
            tenantOrder.push("tenant-a:start");
            await tenantAGate;
            tenantOrder.push("tenant-a:end");
        },
        TENANT
    );
    const tenantB = runQueued(
        "same-id-across-tenants",
        async () => {
            tenantOrder.push("tenant-b:start");
        },
        OTHER_TENANT
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
        tenantOrder,
        ["tenant-a:start", "tenant-b:start"],
        "different tenants must not share an in-process idempotency queue"
    );
    releaseTenantA();
    await Promise.all([tenantA, tenantB]);

    await assert.rejects(
        runQueued("recover-after-error", async () => {
            throw new Error("first failed");
        }),
        /first failed/
    );
    assert.equal(
        await runQueued("recover-after-error", async () => "continued"),
        "continued"
    );

    const rpcCalls = [];
    const rpcResponses = new Map([
        [
            "claim_chat_generation",
            {
                claimed: true,
                message: { id: "message-1" }
            }
        ],
        ["renew_chat_generation_lease", true],
        [
            "commit_chat_generation_reply",
            {
                committed: true,
                assistant_message: { id: "assistant-1" }
            }
        ],
        ["fail_chat_generation_lease", true]
    ]);
    const leaseStore = createChatGenerationLeaseStore(
        {
            async rpc(name, params) {
                rpcCalls.push({ name, params });
                return { data: rpcResponses.get(name), error: null };
            }
        },
        { leaseSeconds: 720 }
    );
    assert.equal(
        (
            await leaseStore.claim(
                MESSAGE_ID.toLowerCase(),
                LEASE_ID,
                TENANT
            )
        ).claimed,
        true
    );
    assert.equal(
        await leaseStore.renew(
            MESSAGE_ID.toLowerCase(),
            LEASE_ID,
            TENANT
        ),
        true
    );
    assert.equal(
        (
            await leaseStore.commit({
                ...TENANT,
                clientMessageId: MESSAGE_ID.toLowerCase(),
                leaseId: LEASE_ID,
                content: "完成",
                toolCalls: { response_mode: "custom" }
            })
        ).assistant_message.id,
        "assistant-1"
    );
    assert.equal(
        await leaseStore.fail(
            MESSAGE_ID.toLowerCase(),
            LEASE_ID,
            TENANT
        ),
        true
    );
    await assert.rejects(
        leaseStore.claim(MESSAGE_ID.toLowerCase(), LEASE_ID, {
            userId: TENANT.userId
        }),
        /requires valid userId and companionId UUIDs/
    );
    assert.deepEqual(
        rpcCalls.map((item) => item.name),
        [
            "claim_chat_generation",
            "renew_chat_generation_lease",
            "commit_chat_generation_reply",
            "fail_chat_generation_lease"
        ]
    );
    for (const call of rpcCalls) {
        assert.equal(call.params.p_user_id, TENANT.userId);
        assert.equal(call.params.p_companion_id, TENANT.companionId);
    }
    assert.equal(rpcCalls[0].params.p_lease_seconds, 720);
    assert.equal(rpcCalls[2].params.p_content, "完成");

    const heartbeat = createChatGenerationLeaseHeartbeat({
        renew: async () => true
    });
    await heartbeat.assertOwned();
    await heartbeat.stop();

    const lostHeartbeat = createChatGenerationLeaseHeartbeat({
        renew: async () => false
    });
    await assert.rejects(
        lostHeartbeat.assertOwned(),
        (error) => error.code === "CHAT_GENERATION_IN_PROGRESS"
    );
    await lostHeartbeat.stop();

    const rpcError = new Error("database unavailable");
    const failingStore = createChatGenerationLeaseStore({
        async rpc() {
            return { data: null, error: rpcError };
        }
    });
    await assert.rejects(
        failingStore.claim(MESSAGE_ID.toLowerCase(), LEASE_ID),
        rpcError
    );
}

runQueueTests()
    .then(() => console.log("chat client-message idempotency helpers passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
