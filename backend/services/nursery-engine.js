const { createHash } = require("node:crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const END_TOKEN = "\u0003";
const STAGE_POLICY_VERSION = 1;
const NURSERY_CONTEXT_MAX_CHARS = 800;

const STAGES = Object.freeze([
    Object.freeze({
        id: "infant",
        label: "婴儿期",
        startsAtDay: 0,
        maxOrder: 1,
        minLength: 1,
        maxLength: 8,
        vocabularyRatio: 0.35,
        overlapLimit: 6
    }),
    Object.freeze({
        id: "toddler",
        label: "幼儿期",
        startsAtDay: 4,
        maxOrder: 2,
        minLength: 2,
        maxLength: 16,
        vocabularyRatio: 0.55,
        overlapLimit: 8
    }),
    Object.freeze({
        id: "child",
        label: "童年期",
        startsAtDay: 12,
        maxOrder: 3,
        minLength: 4,
        maxLength: 32,
        vocabularyRatio: 0.75,
        overlapLimit: 11
    }),
    Object.freeze({
        id: "teen",
        label: "青春期",
        startsAtDay: 24,
        maxOrder: 4,
        minLength: 6,
        maxLength: 50,
        vocabularyRatio: 0.9,
        overlapLimit: 14
    }),
    Object.freeze({
        id: "adult",
        label: "成年期",
        startsAtDay: 36,
        maxOrder: 5,
        minLength: 8,
        maxLength: 80,
        vocabularyRatio: 1,
        overlapLimit: 18
    })
]);

const ACTIONS = Object.freeze([
    "feed",
    "soothe",
    "diaper",
    "burp",
    "play",
    "teach",
    "talk",
    "discipline",
    "event"
]);

const TEXT_ACTIONS = new Set(["feed", "teach", "talk"]);
const NURSERY_KEYWORDS = [
    "孩子",
    "宝宝",
    "宝贝",
    "小朋友",
    "育儿",
    "养娃",
    "奶娃",
    "喂孩子",
    "哄孩子",
    "给孩子",
    "孩子名字",
    "女儿",
    "儿子",
    "baby",
    "nursery"
];

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
    return Math.min(maximum, Math.max(minimum, finiteNumber(value)));
}

function characterSlice(value, maximum) {
    return Array.from(String(value || ""))
        .slice(0, Math.max(0, maximum))
        .join("");
}

function cleanNurseryText(value, maximum = 1000) {
    return characterSlice(
        String(value || "")
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        maximum
    );
}

function maskNurseryPrivateText(value) {
    return cleanNurseryText(value)
        .replace(
            /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
            "[邮箱]"
        )
        .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, "[电话]")
        .replace(
            /\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi,
            "[密钥]"
        )
        .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[长串]");
}

function logicalAgeMs(child, now = new Date()) {
    const bornAt = new Date(child?.born_at || child?.bornAt || 0);
    const current = now instanceof Date ? now : new Date(now);
    if (
        Number.isNaN(bornAt.getTime()) ||
        Number.isNaN(current.getTime())
    ) {
        return 0;
    }
    const pauseStarted = child?.paused_at
        ? new Date(child.paused_at).getTime()
        : null;
    const activeUntil = Number.isFinite(pauseStarted)
        ? Math.min(current.getTime(), pauseStarted)
        : current.getTime();
    const pausedMs = Math.max(
        0,
        finiteNumber(child?.total_paused_seconds, 0) * 1000
    );
    return Math.max(0, activeUntil - bornAt.getTime() - pausedMs);
}

function deriveNurseryStage(child, now = new Date()) {
    const ageDays = logicalAgeMs(child, now) / DAY_MS;
    let stage = STAGES[0];
    for (const candidate of STAGES) {
        if (ageDays >= candidate.startsAtDay) stage = candidate;
    }
    return {
        ...stage,
        ageDays,
        ageHours: ageDays * 24,
        policyVersion:
            Number(child?.stage_policy_version) || STAGE_POLICY_VERSION
    };
}

function normalizeNurseryState(value = {}, now = new Date()) {
    const timestamp =
        value.last_settled_at || value.updated_at || now.toISOString();
    return {
        mood: clamp(value.mood ?? 70),
        health: clamp(value.health ?? 85),
        intimacy: clamp(value.intimacy ?? 20),
        nutrition: clamp(value.nutrition ?? 65),
        fatigue: clamp(value.fatigue ?? 20),
        darkness: clamp(value.darkness ?? 0),
        digest_load: clamp(value.digest_load ?? 0),
        last_settled_at: timestamp,
        last_fed_at: value.last_fed_at || null,
        last_interaction_at: value.last_interaction_at || null
    };
}

function settleNurseryState(value, child, now = new Date()) {
    const current = now instanceof Date ? now : new Date(now);
    const state = normalizeNurseryState(value, current);
    const last = new Date(state.last_settled_at);
    if (
        Number.isNaN(current.getTime()) ||
        Number.isNaN(last.getTime()) ||
        current.getTime() <= last.getTime() ||
        child?.status === "graduated"
    ) {
        return { ...state, last_settled_at: current.toISOString() };
    }

    const elapsedHours = (current.getTime() - last.getTime()) / 3_600_000;
    return {
        ...state,
        mood: clamp(state.mood - elapsedHours * 0.18),
        health: clamp(state.health - elapsedHours * 0.04),
        nutrition: clamp(state.nutrition - elapsedHours * 1.1),
        fatigue: clamp(state.fatigue + elapsedHours * 0.6),
        digest_load: clamp(state.digest_load - elapsedHours * 1.25),
        last_settled_at: current.toISOString()
    };
}

function actionDiminishingFactor(previousCount) {
    return Math.max(0.25, Math.pow(0.75, Math.max(0, previousCount)));
}

function textNutrition(value) {
    const text = cleanNurseryText(value);
    if (!text) return 0;
    const characters = Array.from(text);
    const unique = new Set(characters).size;
    const bigrams = new Set();
    for (let index = 0; index < characters.length - 1; index += 1) {
        bigrams.add(`${characters[index]}${characters[index + 1]}`);
    }
    return Math.min(
        18,
        3 + unique * 0.35 + Math.sqrt(bigrams.size) * 0.7
    );
}

function actionStateChanges({ action, state, text = "", previousCount = 0 }) {
    if (!ACTIONS.includes(action)) {
        throw new Error(`Unknown nursery action: ${action}`);
    }
    const factor =
        action === "discipline"
            ? 1
            : actionDiminishingFactor(previousCount);
    const scaled = (value) => value * factor;
    const changes = {
        mood: 0,
        health: 0,
        intimacy: 0,
        nutrition: 0,
        fatigue: 0,
        darkness: 0,
        digest_load: 0
    };

    if (action === "feed") {
        changes.mood = scaled(4);
        changes.health = scaled(2);
        changes.intimacy = scaled(3);
        changes.nutrition = scaled(12);
        changes.digest_load = scaled(4 + textNutrition(text));
    } else if (action === "soothe") {
        const calmMultiplier = state.mood >= 72 ? 0.5 : 1;
        changes.mood = scaled(13 * calmMultiplier);
        changes.intimacy = scaled(6);
        changes.fatigue = scaled(-4);
        changes.darkness = scaled(-3);
    } else if (action === "diaper") {
        changes.mood = scaled(6);
        changes.health = scaled(8);
        changes.intimacy = scaled(2);
    } else if (action === "burp") {
        changes.mood = scaled(4);
        changes.health = scaled(3);
        changes.nutrition = scaled(3);
    } else if (action === "play") {
        changes.mood = scaled(10);
        changes.intimacy = scaled(5);
        changes.fatigue = scaled(7);
        changes.digest_load = scaled(-2);
    } else if (action === "teach") {
        changes.mood = scaled(3);
        changes.intimacy = scaled(4);
        changes.digest_load = scaled(6 + textNutrition(text));
    } else if (action === "talk") {
        changes.mood = scaled(5);
        changes.intimacy = scaled(4);
        changes.digest_load = scaled(3 + textNutrition(text) * 0.6);
    } else if (action === "discipline") {
        changes.mood = -9;
        changes.intimacy = -3;
        changes.darkness = 6;
        changes.fatigue = 2;
    } else if (action === "event") {
        changes.mood = -8;
        changes.fatigue = 6;
        changes.nutrition = -4;
    }
    return changes;
}

function applyStateChanges(state, changes, now = new Date(), action = "") {
    const next = { ...state };
    for (const key of [
        "mood",
        "health",
        "intimacy",
        "nutrition",
        "fatigue",
        "darkness",
        "digest_load"
    ]) {
        next[key] = clamp(finiteNumber(state[key]) + finiteNumber(changes[key]));
    }
    next.last_settled_at = now.toISOString();
    next.last_interaction_at = now.toISOString();
    if (action === "feed") next.last_fed_at = now.toISOString();
    return next;
}

function bondChanges(action, state) {
    if (action === "discipline") {
        return {
            attachment: -2,
            trust: -3,
            predictability: 1,
            resentment: 6
        };
    }
    if (action === "soothe") {
        return {
            attachment: 4,
            trust: state.mood < 65 ? 5 : 2,
            predictability: 3,
            resentment: -2
        };
    }
    if (["feed", "diaper", "burp"].includes(action)) {
        return {
            attachment: 3,
            trust: 3,
            predictability: 4,
            resentment: -1
        };
    }
    return {
        attachment: 3,
        trust: 2,
        predictability: 1,
        resentment: -1
    };
}

function hashSeed(value) {
    const digest = createHash("sha256").update(String(value)).digest();
    return digest.readUInt32LE(0);
}

function seededRandom(seed) {
    let state = hashSeed(seed) || 0x6d2b79f5;
    return () => {
        state += 0x6d2b79f5;
        let output = state;
        output = Math.imul(output ^ (output >>> 15), output | 1);
        output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
        return ((output ^ (output >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function weightedChoice(weights, random) {
    const entries = [...weights.entries()].filter(
        ([token, count]) => token && finiteNumber(count) > 0
    );
    const total = entries.reduce(
        (sum, [, count]) => sum + finiteNumber(count),
        0
    );
    if (!entries.length || total <= 0) return "";
    let cursor = random() * total;
    for (const [token, count] of entries) {
        cursor -= finiteNumber(count);
        if (cursor <= 0) return token;
    }
    return entries.at(-1)[0];
}

function buildCharacterModel(corpus, maxOrder = 5) {
    const orders = Array.from(
        { length: Math.max(1, Math.min(5, maxOrder)) + 1 },
        () => new Map()
    );
    const characterCounts = new Map();
    const sourceTexts = [];
    for (const row of Array.isArray(corpus) ? corpus : []) {
        const text = cleanNurseryText(row?.text ?? row, 1000);
        if (!text) continue;
        sourceTexts.push(text);
        const characters = Array.from(text);
        for (const character of characters) {
            characterCounts.set(
                character,
                (characterCounts.get(character) || 0) + 1
            );
        }
        for (let index = 0; index <= characters.length; index += 1) {
            const next = index === characters.length
                ? END_TOKEN
                : characters[index];
            for (
                let order = 0;
                order < orders.length && order <= index;
                order += 1
            ) {
                const context = characters
                    .slice(Math.max(0, index - order), index)
                    .join("");
                if (!orders[order].has(context)) {
                    orders[order].set(context, new Map());
                }
                const transitions = orders[order].get(context);
                transitions.set(next, (transitions.get(next) || 0) + 1);
            }
        }
    }
    return { orders, characterCounts, sourceTexts };
}

function allowedVocabulary(characterCounts, ratio) {
    const ranked = [...characterCounts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    );
    const count = Math.max(1, Math.ceil(ranked.length * clamp(ratio, 0, 1)));
    return new Set(ranked.slice(0, count).map(([character]) => character));
}

function longestCommonSubstringLength(leftValue, rightValue, stopAt = Infinity) {
    const left = Array.from(leftValue || "");
    const right = Array.from(rightValue || "");
    if (!left.length || !right.length) return 0;
    let previous = new Uint16Array(right.length + 1);
    let longest = 0;
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = new Uint16Array(right.length + 1);
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            if (left[leftIndex - 1] === right[rightIndex - 1]) {
                current[rightIndex] = previous[rightIndex - 1] + 1;
                longest = Math.max(longest, current[rightIndex]);
                if (longest >= stopAt) return longest;
            }
        }
        previous = current;
    }
    return longest;
}

function excessiveSourceOverlap(output, sourceTexts, limit) {
    if (Array.from(output || "").length < limit) return false;
    return sourceTexts.some(
        (source) =>
            longestCommonSubstringLength(output, source, limit) >= limit
    );
}

function babbleFor(seed, stageId = "infant") {
    const options = stageId === "infant"
        ? ["啊啊", "呜呀", "咿呀", "嗯呐", "哇啊"]
        : ["嗯……", "呀呀", "抱抱", "不要", "在呢"];
    return options[hashSeed(seed) % options.length];
}

function generateChildUtterance({
    corpus,
    child,
    stage,
    recentUtterances = [],
    trigger = "action"
}) {
    const stageInfo = stage?.id ? stage : deriveNurseryStage(child);
    const model = buildCharacterModel(corpus, stageInfo.maxOrder);
    if (model.characterCounts.size === 0) {
        return {
            text: babbleFor(`${child?.rng_seed}:${trigger}`, stageInfo.id),
            stage: stageInfo.id,
            attempts: 0,
            local: true
        };
    }
    const allowed = allowedVocabulary(
        model.characterCounts,
        stageInfo.vocabularyRatio
    );
    const recent = new Set(
        (Array.isArray(recentUtterances) ? recentUtterances : [])
            .map((item) => cleanNurseryText(item?.text ?? item, 160))
            .filter(Boolean)
    );

    for (let attempt = 0; attempt < 16; attempt += 1) {
        const random = seededRandom(
            `${child?.rng_seed}:${stageInfo.id}:${trigger}:${model.sourceTexts.length}:${attempt}`
        );
        const output = [];
        while (output.length < stageInfo.maxLength) {
            let token = "";
            const highestOrder = Math.min(
                stageInfo.maxOrder,
                output.length,
                model.orders.length - 1
            );
            for (let order = highestOrder; order >= 0; order -= 1) {
                const context = output.slice(-order).join("");
                const transitions = model.orders[order].get(context);
                if (!transitions) continue;
                const filtered = new Map(
                    [...transitions.entries()].filter(
                        ([candidate]) =>
                            candidate === END_TOKEN || allowed.has(candidate)
                    )
                );
                if (filtered.size) {
                    token = weightedChoice(filtered, random);
                    break;
                }
            }
            if (!token || token === END_TOKEN) {
                if (output.length >= stageInfo.minLength) break;
                token = weightedChoice(
                    new Map(
                        [...model.characterCounts.entries()].filter(
                            ([candidate]) => allowed.has(candidate)
                        )
                    ),
                    random
                );
            }
            if (!token || token === END_TOKEN) break;
            output.push(token);
            if (
                output.length >= stageInfo.minLength &&
                /[。！？!?~～]$/.test(token) &&
                random() < 0.72
            ) {
                break;
            }
        }
        const text = cleanNurseryText(output.join(""), stageInfo.maxLength);
        if (
            Array.from(text).length < stageInfo.minLength ||
            recent.has(text) ||
            excessiveSourceOverlap(
                text,
                model.sourceTexts,
                stageInfo.overlapLimit
            )
        ) {
            continue;
        }
        return {
            text,
            stage: stageInfo.id,
            attempts: attempt + 1,
            local: true
        };
    }

    return {
        text: babbleFor(
            `${child?.rng_seed}:${trigger}:fallback`,
            stageInfo.id
        ),
        stage: stageInfo.id,
        attempts: 16,
        local: true,
        fallback: true
    };
}

function isNurseryRelevant(value) {
    const text = cleanNurseryText(value, 4000).toLowerCase();
    return Boolean(text) && NURSERY_KEYWORDS.some((keyword) => text.includes(keyword));
}

function buildNurseryRuntimeContext(snapshot, latestUserText, maximum = NURSERY_CONTEXT_MAX_CHARS) {
    if (!snapshot?.child || !isNurseryRelevant(latestUserText)) return "";
    const stage = snapshot.stage || deriveNurseryStage(snapshot.child);
    const state = normalizeNurseryState(snapshot.state || {});
    const name = snapshot.child.name || "还没有名字";
    const bonds = Array.isArray(snapshot.bonds) ? snapshot.bonds : [];
    const userBond = bonds.find((item) => item.caregiver_kind === "user");
    const companionBond = bonds.find(
        (item) => item.caregiver_kind === "companion"
    );
    const latest = snapshot.latest_utterance?.text
        ? `; 最近说了“${cleanNurseryText(snapshot.latest_utterance.text, 80)}”`
        : "";
    const text = [
        "[nursery_state]",
        `我们共同照顾的孩子：${name}；阶段=${stage.label}；年龄=${stage.ageDays.toFixed(1)}天；状态=${snapshot.child.status}`,
        `当前数值：心情=${Math.round(state.mood)}；健康=${Math.round(state.health)}；饱足=${Math.round(state.nutrition)}；疲劳=${Math.round(state.fatigue)}${latest}`,
        `关系：对我亲近=${Math.round(finiteNumber(userBond?.attachment, 20))}；对伴侣亲近=${Math.round(finiteNumber(companionBond?.attachment, 20))}`,
        "[/nursery_state]"
    ].join("\n");
    return characterSlice(text, Math.max(120, Math.min(800, maximum)));
}

module.exports = {
    ACTIONS,
    DAY_MS,
    NURSERY_CONTEXT_MAX_CHARS,
    STAGES,
    STAGE_POLICY_VERSION,
    TEXT_ACTIONS,
    actionDiminishingFactor,
    actionStateChanges,
    applyStateChanges,
    bondChanges,
    buildCharacterModel,
    buildNurseryRuntimeContext,
    cleanNurseryText,
    deriveNurseryStage,
    excessiveSourceOverlap,
    generateChildUtterance,
    isNurseryRelevant,
    logicalAgeMs,
    maskNurseryPrivateText,
    normalizeNurseryState,
    settleNurseryState,
    textNutrition
};
