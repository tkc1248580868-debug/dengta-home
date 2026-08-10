const assert = require("node:assert/strict");
const requestScopeModule = require("../services/request-scope");

assert.deepEqual(Object.keys(requestScopeModule).sort(), [
    "createRequestScope",
    "createTenantDatabase",
    "requireRequestScope"
]);

const {
    createRequestScope,
    createTenantDatabase,
    requireRequestScope
} = requestScopeModule;

const userId = "11111111-1111-4111-8111-111111111111";
const companionId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const otherCompanionId = "44444444-4444-4444-8444-444444444444";

function fakeBuilder(log) {
    const builder = {
        eq(column, value) {
            log.push(["eq", column, value]);
            return builder;
        },
        select(...args) {
            log.push(["select-after-write", ...args]);
            return builder;
        },
        single() {
            log.push(["single"]);
            return builder;
        }
    };
    return builder;
}

function fakeAdminSupabase(log) {
    return {
        from(table) {
            const builder = fakeBuilder(log);
            return {
                select(...args) {
                    log.push([table, "select", ...args]);
                    return builder;
                },
                insert(values, options) {
                    log.push([table, "insert", values, options]);
                    return builder;
                },
                upsert(values, options) {
                    log.push([table, "upsert", values, options]);
                    return builder;
                },
                update(values, options) {
                    log.push([table, "update", values, options]);
                    return builder;
                },
                delete(options) {
                    log.push([table, "delete", options]);
                    return builder;
                }
            };
        }
    };
}

function scopeInput(overrides = {}) {
    const companion = {
        id: companionId,
        user_id: userId,
        name: "小灯",
        is_default: true,
        status: "active"
    };
    return {
        adminSupabase: fakeAdminSupabase(overrides.log || []),
        user: {
            id: userId,
            email: "owner@example.test",
            user_metadata: { display_name: "桃桃" }
        },
        profile: {
            id: userId,
            role: "owner",
            status: "active",
            preferences: { color: "coral" }
        },
        companions: [companion],
        companion,
        ...overrides
    };
}

const log = [];
const input = scopeInput({ log });
const scope = createRequestScope(input);

assert.equal(requireRequestScope({ scope }), scope);
assert.throws(
    () => requireRequestScope({}),
    (error) =>
        error?.status === 401 &&
        error?.code === "authentication_required"
);
assert.throws(
    () => requireRequestScope({ scope: { userId, companionId } }),
    (error) => error?.code === "authentication_required",
    "伪造的普通对象不能冒充 RequestScope"
);

assert.equal(scope.userId, userId);
assert.equal(scope.companionId, companionId);
assert.equal(scope.isOwner, true);
assert.equal(scope.isAdmin, true);
assert.equal(Object.isFrozen(scope), true);
assert.equal(Object.isFrozen(scope.user), true);
assert.equal(Object.isFrozen(scope.user.user_metadata), true);
assert.equal(Object.isFrozen(scope.profile), true);
assert.equal(Object.isFrozen(scope.profile.preferences), true);
assert.equal(Object.isFrozen(scope.companions), true);
assert.equal(Object.isFrozen(scope.companions[0]), true);
assert.equal(Object.isFrozen(scope.companion), true);
assert.notEqual(scope.user, input.user, "scope 不应冻结或复用调用方对象");
assert.notEqual(scope.profile, input.profile);

scope.db.from("messages").select("*").eq("id", 9);
scope.db.from("nursery_children").select("id").eq("status", "active");
scope.db.from("nursery_actions").insert({
    id: "55555555-5555-4555-8555-555555555555",
    child_id: "66666666-6666-4666-8666-666666666666",
    actor: "user",
    kind: "play",
    user_id: otherUserId,
    companion_id: otherCompanionId
});
scope.db
    .from("conversations")
    .insert({
        title: "new",
        user_id: otherUserId,
        companion_id: otherCompanionId
    })
    .select("id");
scope.db
    .from("messages")
    .insert([
        {
            role: "user",
            content: "one",
            user_id: otherUserId,
            companion_id: otherCompanionId
        },
        { role: "assistant", content: "two" }
    ]);
scope.db.from("conversations").update({
    title: "renamed",
    user_id: otherUserId,
    companion_id: otherCompanionId
});
scope.db.from("conversations").delete();

assert.deepEqual(log.slice(1, 3), [
    ["eq", "user_id", userId],
    ["eq", "companion_id", companionId]
]);
const insertedNurseryAction = log.find(
    (entry) => entry[0] === "nursery_actions" && entry[1] === "insert"
);
assert.equal(insertedNurseryAction[2].user_id, userId);
assert.equal(insertedNurseryAction[2].companion_id, companionId);
const insertedConversation = log.find(
    (entry) => entry[0] === "conversations" && entry[1] === "insert"
);
assert.deepEqual(insertedConversation[2], {
    title: "new",
    user_id: userId,
    companion_id: companionId
});
const insertedMessages = log.find(
    (entry) => entry[0] === "messages" && entry[1] === "insert"
);
assert.deepEqual(
    insertedMessages[2].map(({ user_id, companion_id }) => ({
        user_id,
        companion_id
    })),
    [
        { user_id: userId, companion_id: companionId },
        { user_id: userId, companion_id: companionId }
    ]
);
const updatedConversation = log.find(
    (entry) => entry[0] === "conversations" && entry[1] === "update"
);
assert.deepEqual(updatedConversation[2], {
    title: "renamed",
    user_id: userId,
    companion_id: companionId
});
assert.equal(
    log.filter(
        (entry) =>
            entry[0] === "eq" &&
            entry[1] === "user_id" &&
            entry[2] === userId
    ).length >= 3,
    true,
    "select、update、delete 都必须附加用户过滤"
);
assert.equal(
    log.filter(
        (entry) =>
            entry[0] === "eq" &&
            entry[1] === "companion_id" &&
            entry[2] === companionId
    ).length >= 3,
    true,
    "select、update、delete 都必须附加伴侣过滤"
);
assert.equal(scope.db.from("messages").upsert, undefined);
assert.throws(
    () => scope.db.from("unknown_table"),
    /does not allow unscoped table/
);

assert.throws(
    () =>
        createRequestScope(
            scopeInput({
                profile: {
                    id: otherUserId,
                    role: "member",
                    status: "active"
                }
            })
        ),
    /profile.*user/i
);
assert.throws(
    () =>
        createRequestScope(
            scopeInput({
                companions: []
            })
        ),
    /companion/i
);
assert.throws(
    () =>
        createRequestScope(
            scopeInput({
                companion: {
                    id: companionId,
                    user_id: otherUserId,
                    status: "active"
                }
            })
        ),
    /companion.*user/i
);
assert.throws(
    () => {
        const inactive = {
            id: companionId,
            user_id: userId,
            status: "archived"
        };
        createRequestScope(
            scopeInput({
                companions: [inactive],
                companion: inactive
            })
        );
    },
    /active companion/i
);
assert.throws(
    () =>
        createRequestScope(
            scopeInput({
                companion: {
                    id: otherCompanionId,
                    user_id: userId,
                    status: "active"
                }
            })
        ),
    /selected companion/i
);
assert.throws(
    () => {
        const foreignCompanion = {
            id: otherCompanionId,
            user_id: otherUserId,
            status: "active"
        };
        createRequestScope(
            scopeInput({
                companions: [
                    scopeInput().companion,
                    foreignCompanion
                ]
            })
        );
    },
    /companion.*user/i
);

const workerLog = [];
const workerAdmin = fakeAdminSupabase(workerLog);
const workerDatabase = createTenantDatabase({
    adminSupabase: workerAdmin,
    tenant: { userId, companionId }
});
assert.notEqual(workerDatabase, workerAdmin);
workerDatabase.from("background_jobs").select("id").eq("id", "job-1");
assert.deepEqual(workerLog.slice(1, 3), [
    ["eq", "user_id", userId],
    ["eq", "companion_id", companionId]
]);
assert.throws(
    () =>
        createTenantDatabase({
            adminSupabase: workerAdmin,
            tenant: { userId: "invalid", companionId }
        }),
    /valid user and companion identifiers/
);

console.log("request scope ownership and public interface tests passed");
