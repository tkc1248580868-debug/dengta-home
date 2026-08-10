const { creativeError } = require("./companion-creative");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CREATIVE_INSPIRATIONS = 6;

function cleanText(value, maxLength = 1000) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function normalizeTags(value) {
    const source = Array.isArray(value) ? value : [];
    return [...new Set(source.map((item) => cleanText(item, 40)).filter(Boolean))]
        .slice(0, 12);
}

function normalizeSourceUrl(value) {
    const text = cleanText(value, 1200);
    if (!text) return null;
    try {
        const parsed = new URL(text);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        return parsed.toString();
    } catch {
        throw creativeError(
            "灵感来源链接必须是完整的 HTTP 或 HTTPS 地址。",
            "creative_inspiration_url_invalid"
        );
    }
}

function normalizeTimestamp(value) {
    const text = cleanText(value, 80);
    if (!text) return null;
    const timestamp = Date.parse(text);
    if (!Number.isFinite(timestamp)) {
        throw creativeError(
            "灵感发布时间格式不正确。",
            "creative_inspiration_time_invalid"
        );
    }
    return new Date(timestamp).toISOString();
}

function normalizeCreativeInspiration(input = {}, current = {}) {
    const source = cleanText(input.source ?? current.source, 80).toLowerCase();
    const sourceLabel = cleanText(
        input.source_label ?? current.source_label ?? source,
        120
    );
    const title = cleanText(input.title ?? current.title, 240);
    const summary = cleanText(input.summary ?? current.summary, 4000);
    const craftNotes = cleanText(
        input.craft_notes ?? current.craft_notes,
        4000
    );
    if (!source || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(source)) {
        throw creativeError(
            "灵感来源标识只能使用字母、数字、点、下划线或短横线。",
            "creative_inspiration_source_invalid"
        );
    }
    if (!title || (!summary && !craftNotes)) {
        throw creativeError(
            "灵感条目需要标题，以及摘要或创作建议。",
            "creative_inspiration_incomplete"
        );
    }
    return {
        source,
        source_label: sourceLabel || source,
        external_id:
            cleanText(input.external_id ?? current.external_id, 240) || null,
        title,
        summary,
        craft_notes: craftNotes,
        tags: normalizeTags(input.tags ?? current.tags),
        source_url: normalizeSourceUrl(
            input.source_url ?? current.source_url
        ),
        published_at: normalizeTimestamp(
            input.published_at ?? current.published_at
        ),
        enabled:
            Object.hasOwn(input, "enabled")
                ? input.enabled === true
                : current.enabled !== false
    };
}

function publicCreativeInspiration(row = {}) {
    return {
        id: row.id,
        source: row.source,
        source_label: row.source_label || row.source,
        external_id: row.external_id || null,
        title: row.title,
        summary: row.summary || "",
        craft_notes: row.craft_notes || "",
        tags: normalizeTags(row.tags),
        source_url: row.source_url || null,
        published_at: row.published_at || null,
        enabled: row.enabled !== false,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
    };
}

function buildCreativeInspirationContext(rows = []) {
    return rows
        .filter((row) => row?.enabled !== false && UUID_PATTERN.test(row?.id))
        .slice(0, MAX_CREATIVE_INSPIRATIONS)
        .map((row) => ({
            id: row.id,
            source: cleanText(row.source_label || row.source, 120),
            title: cleanText(row.title, 240),
            advice: cleanText(
                [
                    row.advice || row.summary,
                    row.advice ? "" : row.craft_notes
                ]
                    .map((item) => cleanText(item, 900))
                    .filter(Boolean)
                    .join("\n"),
                1600
            ),
            tags: normalizeTags(row.tags)
        }))
        .filter((row) => row.title && row.advice);
}

async function listCreativeInspirations(
    database,
    { limit = 50, enabledOnly = false } = {}
) {
    let query = database
        .from("companion_creative_inspirations")
        .select("*");
    if (enabledOnly) query = query.eq("enabled", true);
    const { data, error } = await query
        .order("updated_at", { ascending: false })
        .limit(Math.max(1, Math.min(100, Math.round(Number(limit) || 50))));
    if (error) throw error;
    return (data || []).map(publicCreativeInspiration);
}

async function saveCreativeInspiration(
    database,
    input = {},
    now = () => new Date()
) {
    const normalized = normalizeCreativeInspiration(input);
    let existing = null;
    if (normalized.external_id) {
        const found = await database
            .from("companion_creative_inspirations")
            .select("*")
            .eq("source", normalized.source)
            .eq("external_id", normalized.external_id)
            .limit(1)
            .maybeSingle();
        if (found.error) throw found.error;
        existing = found.data || null;
    }
    const timestamp = now().toISOString();
    const values = {
        ...normalized,
        updated_at: timestamp,
        ...(existing ? {} : { created_at: timestamp })
    };
    const result = existing
        ? await database
              .from("companion_creative_inspirations")
              .update(values)
              .eq("id", existing.id)
              .select("*")
              .single()
        : await database
              .from("companion_creative_inspirations")
              .insert(values)
              .select("*")
              .single();
    if (result.error) throw result.error;
    return publicCreativeInspiration(result.data);
}

async function updateCreativeInspiration(
    database,
    id,
    input = {},
    now = () => new Date()
) {
    if (!UUID_PATTERN.test(String(id || ""))) {
        throw creativeError(
            "灵感条目编号格式不正确。",
            "creative_inspiration_id_invalid"
        );
    }
    const current = await database
        .from("companion_creative_inspirations")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) {
        throw creativeError(
            "没有找到这条创作灵感。",
            "creative_inspiration_not_found",
            404
        );
    }
    const values = {
        ...normalizeCreativeInspiration(input, current.data),
        updated_at: now().toISOString()
    };
    const result = await database
        .from("companion_creative_inspirations")
        .update(values)
        .eq("id", id)
        .select("*")
        .single();
    if (result.error) throw result.error;
    return publicCreativeInspiration(result.data);
}

async function deleteCreativeInspiration(database, id) {
    if (!UUID_PATTERN.test(String(id || ""))) {
        throw creativeError(
            "灵感条目编号格式不正确。",
            "creative_inspiration_id_invalid"
        );
    }
    const result = await database
        .from("companion_creative_inspirations")
        .delete()
        .eq("id", id);
    if (result.error) throw result.error;
    return { deleted: true, id };
}

module.exports = {
    MAX_CREATIVE_INSPIRATIONS,
    buildCreativeInspirationContext,
    deleteCreativeInspiration,
    listCreativeInspirations,
    normalizeCreativeInspiration,
    publicCreativeInspiration,
    saveCreativeInspiration,
    updateCreativeInspiration
};
