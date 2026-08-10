const {
    IDENTITY_FIELDS,
    MAX_PROFILE_VERSIONS,
    normalizeCompanionProfile
} = require("./tenant-profile-refresh");
const {
    stableUuid
} = require("./tenant-proactive-message");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function profileError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function publicProfileVersion(entry, now = () => new Date()) {
    return {
        id: entry.id,
        version: Number(entry.version) || 0,
        profile: normalizeCompanionProfile(entry.profile, now),
        evidence: Array.isArray(entry.evidence)
            ? entry.evidence
            : [],
        change_reason: cleanText(entry.change_reason, 500),
        confirmed_identity_change:
            entry.confirmed_identity_change === true,
        created_at: entry.created_at || null
    };
}

async function listProfileVersions(
    database,
    { now = () => new Date() } = {}
) {
    const { data, error } = await database
        .from("companion_profile_versions")
        .select(
            "id, version, profile, evidence, change_reason, confirmed_identity_change, created_at"
        )
        .order("version", { ascending: false })
        .limit(MAX_PROFILE_VERSIONS);
    if (error) throw error;
    const versions = (Array.isArray(data) ? data : []).map((entry) =>
        publicProfileVersion(entry, now)
    );
    return {
        profile:
            versions[0]?.profile ||
            normalizeCompanionProfile({}, now),
        latest_version: versions[0]?.version || null,
        versions
    };
}

async function latestProfileVersion(database) {
    const { data, error } = await database
        .from("companion_profile_versions")
        .select(
            "id, version, profile, evidence, change_reason, confirmed_identity_change, created_at"
        )
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function trimOldVersions(database) {
    const { data, error } = await database
        .from("companion_profile_versions")
        .select("id")
        .order("version", { ascending: false })
        .range(MAX_PROFILE_VERSIONS, 999);
    if (error) throw error;
    const ids = (Array.isArray(data) ? data : [])
        .map((entry) => entry.id)
        .filter(Boolean);
    if (!ids.length) return;
    const deleted = await database
        .from("companion_profile_versions")
        .delete()
        .in("id", ids);
    if (deleted.error) throw deleted.error;
}

function actionVersionId(kind, actionId) {
    const normalized = cleanText(actionId, 80);
    return UUID_PATTERN.test(normalized)
        ? stableUuid(`profile-${kind}`, normalized)
        : null;
}

async function insertUserProfileVersion({
    database,
    id,
    version,
    profile,
    evidence,
    changeReason,
    confirmedIdentityChange
}) {
    const inserted = await database
        .from("companion_profile_versions")
        .insert({
            ...(id ? { id } : {}),
            version,
            profile,
            evidence,
            change_reason: changeReason,
            confirmed_identity_change:
                confirmedIdentityChange === true
        })
        .select(
            "id, version, profile, evidence, change_reason, confirmed_identity_change, created_at"
        )
        .maybeSingle();
    if (!inserted.error) {
        await trimOldVersions(database);
        return inserted.data;
    }
    if (inserted.error.code === "23505" && id) {
        const existing = await database
            .from("companion_profile_versions")
            .select(
                "id, version, profile, evidence, change_reason, confirmed_identity_change, created_at"
            )
            .eq("id", id)
            .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) return existing.data;
    }
    if (inserted.error.code === "23505") {
        throw profileError(
            409,
            "profile_version_conflict",
            "角色档案刚刚发生了变化，请刷新后重试。"
        );
    }
    throw inserted.error;
}

async function confirmIdentityProposals({
    database,
    proposalIds,
    clientActionId,
    now = () => new Date()
}) {
    const idempotentVersionId = actionVersionId(
        "identity-confirm",
        clientActionId
    );
    if (idempotentVersionId) {
        const existing = await database
            .from("companion_profile_versions")
            .select(
                "id, version, profile, evidence, change_reason, confirmed_identity_change, created_at"
            )
            .eq("id", idempotentVersionId)
            .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) {
            return publicProfileVersion(existing.data, now);
        }
    }
    const requested = new Set(
        (Array.isArray(proposalIds) ? proposalIds : [])
            .map((value) => cleanText(value, 80))
            .filter(Boolean)
    );
    if (!requested.size) {
        throw profileError(
            400,
            "identity_proposal_required",
            "请选择至少一条要确认的身份提议。"
        );
    }

    const latest = await latestProfileVersion(database);
    if (!latest) {
        throw profileError(
            404,
            "profile_version_not_found",
            "当前还没有可以确认的角色档案。"
        );
    }
    const profile = normalizeCompanionProfile(latest.profile, now);
    const selected = profile.pending_identity_changes.filter(
        (proposal) => requested.has(proposal.id)
    );
    if (selected.length !== requested.size) {
        throw profileError(
            409,
            "identity_proposal_stale",
            "身份提议已经变化，请刷新档案后重新选择。"
        );
    }

    for (const proposal of selected) {
        if (!IDENTITY_FIELDS.includes(proposal.field)) continue;
        profile.identity[proposal.field] = proposal.proposed_value;
    }
    profile.pending_identity_changes =
        profile.pending_identity_changes.filter(
            (proposal) => !requested.has(proposal.id)
        );
    const entry = await insertUserProfileVersion({
        database,
        id: idempotentVersionId,
        version: Number(latest.version) + 1,
        profile,
        evidence: selected.map((proposal) => ({
            field: `confirmed_identity:${proposal.field}`,
            value: proposal.proposed_value,
            message_ids: proposal.evidence_message_ids
        })),
        changeReason: "用户确认了角色身份变化。",
        confirmedIdentityChange: true
    });
    return publicProfileVersion(entry, now);
}

async function restoreProfileVersion({
    database,
    targetVersion,
    clientActionId,
    now = () => new Date()
}) {
    const idempotentVersionId = actionVersionId(
        "restore",
        clientActionId
    );
    if (idempotentVersionId) {
        const existing = await database
            .from("companion_profile_versions")
            .select(
                "id, version, profile, evidence, change_reason, confirmed_identity_change, created_at"
            )
            .eq("id", idempotentVersionId)
            .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) {
            return publicProfileVersion(existing.data, now);
        }
    }
    const version = Number(targetVersion);
    if (!Number.isInteger(version) || version < 1) {
        throw profileError(
            400,
            "profile_version_invalid",
            "角色档案版本号格式不正确。"
        );
    }
    const [latest, targetResult] = await Promise.all([
        latestProfileVersion(database),
        database
            .from("companion_profile_versions")
            .select(
                "id, version, profile, evidence, change_reason, confirmed_identity_change, created_at"
            )
            .eq("version", version)
            .maybeSingle()
    ]);
    if (targetResult.error) throw targetResult.error;
    if (!latest || !targetResult.data) {
        throw profileError(
            404,
            "profile_version_not_found",
            "找不到这个角色档案版本。"
        );
    }
    if (Number(latest.version) === version) {
        return publicProfileVersion(latest, now);
    }

    const entry = await insertUserProfileVersion({
        database,
        id: idempotentVersionId,
        version: Number(latest.version) + 1,
        profile: normalizeCompanionProfile(
            targetResult.data.profile,
            now
        ),
        evidence: [
            {
                field: "version_restore",
                restored_from_version: version
            }
        ],
        changeReason: `用户恢复了角色档案版本 ${version}。`,
        confirmedIdentityChange: true
    });
    return publicProfileVersion(entry, now);
}

module.exports = {
    confirmIdentityProposals,
    listProfileVersions,
    profileError,
    publicProfileVersion,
    restoreProfileVersion
};
