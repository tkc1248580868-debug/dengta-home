const VALID_REQUEST_SCOPES = new WeakSet();
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function immutableCopy(value, seen = new WeakMap()) {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);

    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const [key, item] of Object.entries(value)) {
        copy[key] = immutableCopy(item, seen);
    }
    return Object.freeze(copy);
}

const TABLE_SCOPES = immutableCopy({
    user_profiles: { kind: "profile", companion: false },
    companions: { kind: "user", companion: false },
    settings: { kind: "user", companion: true },
    conversations: { kind: "user", companion: true },
    memories: { kind: "user", companion: true },
    messages: { kind: "user", companion: true },
    moments: { kind: "user", companion: true },
    moment_comments: { kind: "user", companion: true },
    companion_diary_entries: { kind: "user", companion: true },
    companion_profile_versions: { kind: "user", companion: true },
    stable_memory_candidates: { kind: "user", companion: true },
    media_assets: { kind: "user", companion: true },
    push_installations: { kind: "user", companion: false },
    background_jobs: { kind: "user", companion: true },
    delivery_events: { kind: "user", companion: true },
    mcp_connections: { kind: "user", companion: true },
    ai_provider_profiles: { kind: "user", companion: true },
    companion_creative_settings: { kind: "user", companion: true },
    image_provider_profiles: { kind: "user", companion: true },
    companion_creative_inspirations: { kind: "user", companion: true },
    companion_artworks: { kind: "user", companion: true },
    image_generation_calls: { kind: "user", companion: true },
    companion_chat_preferences: { kind: "user", companion: true },
    conversation_composer_hints: { kind: "user", companion: true },
    companion_runtime_states: { kind: "user", companion: true },
    nursery_children: { kind: "user", companion: true },
    nursery_child_state: { kind: "user", companion: true },
    nursery_actions: { kind: "user", companion: true },
    nursery_corpus: { kind: "user", companion: true },
    nursery_utterances: { kind: "user", companion: true },
    nursery_events: { kind: "user", companion: true },
    nursery_milestones: { kind: "user", companion: true },
    nursery_caregiver_bonds: { kind: "user", companion: true }
});

function ownershipFor(table, scope) {
    const definition = TABLE_SCOPES[table];
    if (!definition) {
        throw new Error(`RequestScope does not allow unscoped table: ${table}`);
    }
    if (definition.kind === "profile") {
        return { id: scope.userId };
    }
    const ownership = { user_id: scope.userId };
    if (definition.companion) {
        ownership.companion_id = scope.companionId;
    }
    return ownership;
}

function addOwnershipFilters(builder, ownership) {
    let result = builder;
    for (const [column, value] of Object.entries(ownership)) {
        result = result.eq(column, value);
    }
    return result;
}

function addOwnershipValues(values, ownership) {
    const apply = (row) => ({ ...(row || {}), ...ownership });
    return Array.isArray(values) ? values.map(apply) : apply(values);
}

function scopedTable(source, ownership) {
    return Object.freeze({
        select(...args) {
            return addOwnershipFilters(source.select(...args), ownership);
        },
        insert(values, options) {
            return source.insert(
                addOwnershipValues(values, ownership),
                options
            );
        },
        update(values, options) {
            return addOwnershipFilters(
                source.update(
                    addOwnershipValues(values, ownership),
                    options
                ),
                ownership
            );
        },
        delete(options) {
            return addOwnershipFilters(source.delete(options), ownership);
        }
    });
}

function createScopedDatabase(adminSupabase, scope) {
    return Object.freeze({
        from(table) {
            const ownership = ownershipFor(table, scope);
            return scopedTable(adminSupabase.from(table), ownership);
        }
    });
}

function createTenantDatabase({ adminSupabase, tenant } = {}) {
    if (!adminSupabase || typeof adminSupabase.from !== "function") {
        throw new Error("Tenant database is missing.");
    }
    const ownership = Object.freeze({
        userId: String(tenant?.userId || "").trim(),
        companionId: String(tenant?.companionId || "").trim()
    });
    if (
        !UUID_PATTERN.test(ownership.userId) ||
        !UUID_PATTERN.test(ownership.companionId)
    ) {
        throw new Error(
            "Tenant database requires valid user and companion identifiers."
        );
    }
    return createScopedDatabase(adminSupabase, ownership);
}

function validateScopeInput({ adminSupabase, user, profile, companions, companion }) {
    if (!adminSupabase || typeof adminSupabase.from !== "function") {
        throw new Error("RequestScope database is missing.");
    }
    if (!user || typeof user.id !== "string" || !user.id) {
        throw new Error("RequestScope user is missing.");
    }
    if (!profile || profile.id !== user.id) {
        throw new Error("RequestScope profile must belong to the authenticated user.");
    }
    if (profile.status !== "active") {
        throw new Error("RequestScope requires an active user profile.");
    }
    if (!["owner", "admin", "member"].includes(profile.role)) {
        throw new Error("RequestScope profile role is invalid.");
    }
    if (!Array.isArray(companions) || companions.length === 0) {
        throw new Error("RequestScope companions are missing.");
    }
    for (const item of companions) {
        if (!item || item.user_id !== user.id) {
            throw new Error("RequestScope companion must belong to the authenticated user.");
        }
        if (item.status !== "active") {
            throw new Error("RequestScope requires active companions.");
        }
    }
    if (!companion || companion.user_id !== user.id) {
        throw new Error("RequestScope companion must belong to the authenticated user.");
    }
    if (companion.status !== "active") {
        throw new Error("RequestScope requires an active companion.");
    }
    if (!companions.some((item) => item.id === companion.id)) {
        throw new Error("RequestScope selected companion is not in the account.");
    }
}

function createRequestScope({
    adminSupabase,
    user,
    profile,
    companions,
    companion
}) {
    validateScopeInput({
        adminSupabase,
        user,
        profile,
        companions,
        companion
    });

    const immutableUser = immutableCopy(user);
    const immutableProfile = immutableCopy(profile);
    const immutableCompanions = immutableCopy(companions);
    const immutableCompanion = immutableCompanions.find(
        (item) => item.id === companion.id
    );
    const ownership = Object.freeze({
        userId: immutableUser.id,
        companionId: immutableCompanion.id
    });
    const scope = Object.freeze({
        ...ownership,
        role: immutableProfile.role,
        user: immutableUser,
        profile: immutableProfile,
        companions: immutableCompanions,
        companion: immutableCompanion,
        db: createScopedDatabase(adminSupabase, ownership),
        isOwner: immutableProfile.role === "owner",
        isAdmin:
            immutableProfile.role === "owner" ||
            immutableProfile.role === "admin"
    });
    VALID_REQUEST_SCOPES.add(scope);
    return scope;
}

function requireRequestScope(req) {
    const scope = req?.scope;
    if (!scope || !VALID_REQUEST_SCOPES.has(scope)) {
        const error = new Error("请先登录 DengTa Home。");
        error.status = 401;
        error.code = "authentication_required";
        throw error;
    }
    return scope;
}

module.exports = {
    createRequestScope,
    createTenantDatabase,
    requireRequestScope
};
