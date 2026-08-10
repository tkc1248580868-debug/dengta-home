const assert = require("node:assert/strict");
const {
    confirmIdentityProposals,
    listProfileVersions,
    restoreProfileVersion
} = require("../services/companion-profile-versions");

const CONFIRM_ACTION_ID =
    "10000000-0000-4000-8000-000000000041";
const RESTORE_ACTION_ID =
    "10000000-0000-4000-8000-000000000042";

function createDatabase(initial = []) {
    const tables = {
        companion_profile_versions: structuredClone(initial)
    };

    function from(table) {
        let action = "select";
        let inserted = null;
        const filters = [];
        let orderBy = null;
        let limitCount = null;
        let rangeValue = null;

        function selectedRows() {
            let rows = tables[table].filter((row) =>
                filters.every(([kind, column, value]) => {
                    if (kind === "eq") return row[column] === value;
                    if (kind === "in") return value.includes(row[column]);
                    return true;
                })
            );
            if (orderBy) {
                const [column, options] = orderBy;
                rows = [...rows].sort((left, right) => {
                    const comparison =
                        Number(left[column]) - Number(right[column]);
                    return options?.ascending === false
                        ? -comparison
                        : comparison;
                });
            }
            if (rangeValue) {
                rows = rows.slice(
                    rangeValue[0],
                    rangeValue[1] + 1
                );
            }
            return limitCount == null
                ? rows
                : rows.slice(0, limitCount);
        }

        async function execute() {
            if (action === "insert") {
                if (
                    tables[table].some(
                        (entry) =>
                            entry.id === inserted.id ||
                            entry.version === inserted.version
                    )
                ) {
                    return { data: null, error: { code: "23505" } };
                }
                const saved = {
                    created_at: "2026-07-27T06:00:00.000Z",
                    ...inserted
                };
                tables[table].push(saved);
                return { data: saved, error: null };
            }
            if (action === "delete") {
                const ids = new Set(
                    selectedRows().map((entry) => entry.id)
                );
                tables[table] = tables[table].filter(
                    (entry) => !ids.has(entry.id)
                );
                return { data: null, error: null };
            }
            return { data: selectedRows(), error: null };
        }

        const builder = {
            select() {
                return builder;
            },
            insert(value) {
                action = "insert";
                inserted = structuredClone(value);
                return builder;
            },
            delete() {
                action = "delete";
                return builder;
            },
            eq(column, value) {
                filters.push(["eq", column, value]);
                return builder;
            },
            in(column, value) {
                filters.push(["in", column, value]);
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
            range(start, end) {
                rangeValue = [start, end];
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

function initialVersion() {
    return {
        id: "30000000-0000-4000-8000-000000000041",
        version: 1,
        profile: {
            introduction: "我还在慢慢认识自己。",
            stable: {
                personality_traits: ["慢热"],
                likes: [],
                dislikes: [],
                habits: [],
                communication_style: []
            },
            identity: {
                gender_identity: "",
                pronouns: "",
                relationship_position: ""
            },
            pending_identity_changes: [
                {
                    id: "40000000-0000-4000-8000-000000000041",
                    field: "gender_identity",
                    proposed_value: "非二元",
                    evidence_message_ids: ["1", "2", "3"],
                    proposed_at: "2026-07-27T05:00:00.000Z"
                }
            ],
            current_mood: {
                label: "安静",
                note: "",
                observed_at: "2026-07-27T05:00:00.000Z",
                expires_at: "2026-07-28T05:00:00.000Z",
                evidence_message_ids: ["4"]
            }
        },
        evidence: [],
        change_reason: "首次档案",
        confirmed_identity_change: false,
        created_at: "2026-07-27T05:00:00.000Z"
    };
}

async function testListConfirmRetryAndRestore() {
    const database = createDatabase([initialVersion()]);
    const now = () => new Date("2026-07-27T06:00:00.000Z");

    const initial = await listProfileVersions(database, { now });
    assert.equal(initial.latest_version, 1);
    assert.equal(initial.versions.length, 1);
    assert.equal(initial.profile.current_mood.label, "安静");

    const confirmed = await confirmIdentityProposals({
        database,
        proposalIds: [
            "40000000-0000-4000-8000-000000000041"
        ],
        clientActionId: CONFIRM_ACTION_ID,
        now
    });
    assert.equal(confirmed.version, 2);
    assert.equal(
        confirmed.profile.identity.gender_identity,
        "非二元"
    );
    assert.equal(
        confirmed.profile.pending_identity_changes.length,
        0
    );
    assert.equal(confirmed.confirmed_identity_change, true);

    const retry = await confirmIdentityProposals({
        database,
        proposalIds: [
            "40000000-0000-4000-8000-000000000041"
        ],
        clientActionId: CONFIRM_ACTION_ID,
        now
    });
    assert.equal(retry.id, confirmed.id);
    assert.equal(database.tables.companion_profile_versions.length, 2);

    const restored = await restoreProfileVersion({
        database,
        targetVersion: 1,
        clientActionId: RESTORE_ACTION_ID,
        now
    });
    assert.equal(restored.version, 3);
    assert.equal(restored.profile.identity.gender_identity, "");
    assert.equal(
        restored.profile.pending_identity_changes.length,
        1
    );

    const history = await listProfileVersions(database, { now });
    assert.equal(history.latest_version, 3);
    assert.deepEqual(
        history.versions.map((entry) => entry.version),
        [3, 2, 1]
    );
}

async function testEmptyProfileHasNoSyntheticPersonaIntroduction() {
    const database = createDatabase();
    const result = await listProfileVersions(database, {
        now: () => new Date("2026-07-27T06:00:00.000Z")
    });
    assert.equal(result.latest_version, null);
    assert.equal(result.versions.length, 0);
    assert.equal(result.profile.introduction, "");
}

Promise.resolve()
    .then(testListConfirmRetryAndRestore)
    .then(testEmptyProfileHasNoSyntheticPersonaIntroduction)
    .then(() => console.log("companion profile version tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
