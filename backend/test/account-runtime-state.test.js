const assert = require("node:assert/strict");
const {
    publicAccountSettings,
    readCompanionRuntimeState,
    saveCompanionRuntimeState,
    updateAccountIdentity
} = require("../routes/v2/content");
const { createRequestScope } = require("../services/request-scope");

const USER_A = "11111111-1111-4111-8111-111111111111";
const COMPANION_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";

function memorySupabase() {
    const tables = {
        companion_runtime_states: [],
        user_profiles: [
            {
                id: USER_A,
                display_name: "甲",
                role: "owner",
                status: "active"
            },
            {
                id: USER_B,
                display_name: "乙",
                role: "member",
                status: "active"
            }
        ],
        companions: [
            { id: COMPANION_A, user_id: USER_A, name: "灯甲" },
            { id: COMPANION_B, user_id: USER_B, name: "灯乙" }
        ]
    };

    function from(tableName) {
        const state = {
            operation: "select",
            values: null,
            filters: [],
            columns: "*",
            cardinality: "many"
        };
        const builder = {
            select(columns = "*") {
                state.columns = columns;
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
            maybeSingle() {
                state.cardinality = "maybeSingle";
                return builder;
            },
            single() {
                state.cardinality = "single";
                return builder;
            },
            then(resolve, reject) {
                return Promise.resolve(execute()).then(resolve, reject);
            }
        };

        function matches(row) {
            return state.filters.every(([column, value]) => row[column] === value);
        }

        function project(row) {
            if (!row || state.columns === "*") return row || null;
            return Object.fromEntries(
                state.columns
                    .split(",")
                    .map((column) => column.trim())
                    .filter(Boolean)
                    .map((column) => [column, row[column]])
            );
        }

        function execute() {
            let rows = tables[tableName].filter(matches);
            if (state.operation === "insert") {
                const row = { ...state.values };
                tables[tableName].push(row);
                rows = [row];
            } else if (state.operation === "update") {
                for (const row of rows) Object.assign(row, state.values);
            }
            const data = rows.map(project);
            if (state.cardinality === "single") {
                return {
                    data: data.length === 1 ? data[0] : null,
                    error: data.length === 1 ? null : new Error("Expected one row")
                };
            }
            if (state.cardinality === "maybeSingle") {
                return {
                    data: data[0] || null,
                    error: data.length <= 1 ? null : new Error("Expected at most one row")
                };
            }
            return { data, error: null };
        }

        return builder;
    }

    return { from, tables };
}

function scopeFor(database, userId, companionId, displayName, companionName, role) {
    const companion = {
        id: companionId,
        user_id: userId,
        name: companionName,
        is_default: true,
        status: "active"
    };
    return createRequestScope({
        adminSupabase: database,
        user: {
            id: userId,
            email: `${displayName}@example.test`,
            user_metadata: { display_name: displayName }
        },
        profile: {
            id: userId,
            display_name: displayName,
            role,
            status: "active",
            storage_used_bytes: 12,
            storage_quota_bytes: 34
        },
        companions: [companion],
        companion
    });
}

async function main() {
    const database = memorySupabase();
    const scopeA = scopeFor(database, USER_A, COMPANION_A, "甲", "灯甲", "owner");
    const scopeB = scopeFor(database, USER_B, COMPANION_B, "乙", "灯乙", "member");

    assert.deepEqual(await readCompanionRuntimeState(scopeA), {
        status: null,
        interaction_stats: null,
        updated_at: null
    });
    await saveCompanionRuntimeState(scopeA, {
        status: { mood: "开心", energyLevel: 78 },
        interaction_stats: { counts: { hug: 2 } }
    });
    await saveCompanionRuntimeState(scopeB, {
        status: { mood: "平静", energyLevel: 55 },
        interaction_stats: { counts: { hug: 9 } }
    });

    assert.equal((await readCompanionRuntimeState(scopeA)).status.mood, "开心");
    assert.equal((await readCompanionRuntimeState(scopeB)).status.mood, "平静");
    assert.equal(database.tables.companion_runtime_states.length, 2);
    assert.notEqual(
        database.tables.companion_runtime_states[0].user_id,
        database.tables.companion_runtime_states[1].user_id
    );

    const publicSettings = publicAccountSettings(scopeA, {
        ai_name: "灯甲",
        model: "model-a"
    });
    assert.equal(publicSettings.user_display_name, "甲");
    assert.equal(publicSettings.account_role, "owner");
    assert.equal(publicSettings.storage_quota_bytes, 34);

    const identity = await updateAccountIdentity(scopeA, {
        user_display_name: "新甲",
        ai_name: "新灯甲"
    });
    assert.deepEqual(identity, {
        userDisplayName: "新甲",
        companionName: "新灯甲"
    });
    assert.equal(database.tables.user_profiles[0].display_name, "新甲");
    assert.equal(database.tables.companions[0].name, "新灯甲");
    assert.equal(database.tables.user_profiles[1].display_name, "乙");
    assert.equal(database.tables.companions[1].name, "灯乙");

    await assert.rejects(
        saveCompanionRuntimeState(scopeA, { status: "invalid" }),
        (error) => error.code === "runtime_state_invalid"
    );
    console.log("account runtime state tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
