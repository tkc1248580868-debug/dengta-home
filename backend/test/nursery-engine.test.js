const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
    STAGE_POLICY_VERSION,
    actionDiminishingFactor,
    actionStateChanges,
    applyStateChanges,
    buildNurseryRuntimeContext,
    deriveNurseryStage,
    excessiveSourceOverlap,
    generateChildUtterance,
    isNurseryRelevant,
    maskNurseryPrivateText,
    settleNurseryState
} = require("../services/nursery-engine");

const bornAt = "2026-08-02T00:00:00.000Z";
const child = {
    id: "11111111-1111-4111-8111-111111111111",
    born_at: bornAt,
    status: "active",
    total_paused_seconds: 0,
    stage_policy_version: STAGE_POLICY_VERSION,
    rng_seed: 47291
};

for (const [days, expected] of [
    [0, "infant"],
    [3.999, "infant"],
    [4, "toddler"],
    [11.999, "toddler"],
    [12, "child"],
    [24, "teen"],
    [36, "adult"]
]) {
    assert.equal(
        deriveNurseryStage(
            child,
            new Date(Date.parse(bornAt) + days * 24 * 60 * 60 * 1000)
        ).id,
        expected
    );
}

const pausedStage = deriveNurseryStage(
    {
        ...child,
        total_paused_seconds: 2 * 24 * 60 * 60
    },
    new Date(Date.parse(bornAt) + 5 * 24 * 60 * 60 * 1000)
);
assert.equal(pausedStage.id, "infant");
assert.equal(Number(pausedStage.ageDays.toFixed(1)), 3);

const baselineState = {
    mood: 70,
    health: 85,
    intimacy: 20,
    nutrition: 65,
    fatigue: 20,
    darkness: 0,
    digest_load: 40,
    last_settled_at: bornAt
};
const afterTwoHours = settleNurseryState(
    baselineState,
    child,
    new Date(Date.parse(bornAt) + 2 * 60 * 60 * 1000)
);
const afterFourHoursViaTwoReads = settleNurseryState(
    afterTwoHours,
    child,
    new Date(Date.parse(bornAt) + 4 * 60 * 60 * 1000)
);
const afterFourHoursDirect = settleNurseryState(
    baselineState,
    child,
    new Date(Date.parse(bornAt) + 4 * 60 * 60 * 1000)
);
for (const key of [
    "mood",
    "health",
    "nutrition",
    "fatigue",
    "digest_load"
]) {
    assert.equal(
        Number(afterFourHoursViaTwoReads[key].toFixed(6)),
        Number(afterFourHoursDirect[key].toFixed(6)),
        `${key} settlement must not depend on read frequency`
    );
}

assert.equal(actionDiminishingFactor(0), 1);
assert.equal(actionDiminishingFactor(1), 0.75);
assert.equal(actionDiminishingFactor(2), 0.5625);
assert.equal(actionDiminishingFactor(20), 0.25);
const firstPlay = actionStateChanges({
    action: "play",
    state: baselineState,
    previousCount: 0
});
const repeatedPlay = actionStateChanges({
    action: "play",
    state: baselineState,
    previousCount: 2
});
assert.ok(firstPlay.mood > repeatedPlay.mood);
const applied = applyStateChanges(
    { ...baselineState, mood: 99, fatigue: 98 },
    firstPlay,
    new Date(bornAt),
    "play"
);
assert.equal(applied.mood, 100);
assert.equal(applied.fatigue, 100);

const masked = maskNurseryPrivateText(
    "邮箱 test@example.com，电话 13800138000，key-secret_abcdefghijklmnop"
);
assert.doesNotMatch(masked, /test@example\.com|13800138000|abcdefghijklmnop/);
assert.match(masked, /\[邮箱\]/);
assert.match(masked, /\[电话\]/);

const corpus = [
    { text: "欢迎来到我们的小家，今天窗外有很好看的云。" },
    { text: "抱抱你，慢慢长大，不着急。" },
    { text: "早上喝热牛奶，晚上一起看星星。" },
    { text: "你可以学会说喜欢，也可以说不要。" }
];
const toddlerStage = deriveNurseryStage(
    child,
    new Date(Date.parse(bornAt) + 6 * 24 * 60 * 60 * 1000)
);
const firstSpeech = generateChildUtterance({
    corpus,
    child,
    stage: toddlerStage,
    recentUtterances: [],
    trigger: "talk"
});
const repeatedSpeech = generateChildUtterance({
    corpus,
    child,
    stage: toddlerStage,
    recentUtterances: [],
    trigger: "talk"
});
assert.deepEqual(firstSpeech, repeatedSpeech);
assert.ok(Array.from(firstSpeech.text).length <= toddlerStage.maxLength);
assert.equal(
    excessiveSourceOverlap(
        firstSpeech.text,
        corpus.map((item) => item.text),
        toddlerStage.overlapLimit
    ),
    false
);
const learnedCharacters = new Set(Array.from(corpus.map((item) => item.text).join("")));
for (const character of Array.from(firstSpeech.text)) {
    assert.ok(learnedCharacters.has(character));
}

const snapshot = {
    child: { ...child, name: null, status: "active" },
    stage: toddlerStage,
    state: baselineState,
    bonds: [
        { caregiver_kind: "user", attachment: 33 },
        { caregiver_kind: "companion", attachment: 29 }
    ],
    latest_utterance: { text: firstSpeech.text }
};
assert.equal(isNurseryRelevant("今天晚饭吃什么"), false);
assert.equal(isNurseryRelevant("我们的宝宝今天怎么样"), true);
assert.equal(buildNurseryRuntimeContext(snapshot, "今天晚饭吃什么"), "");
const runtimeContext = buildNurseryRuntimeContext(
    snapshot,
    "我们的宝宝今天怎么样"
);
assert.match(runtimeContext, /\[nursery_state\]/);
assert.match(runtimeContext, /还没有名字/);
assert.ok(Array.from(runtimeContext).length <= 800);
assert.doesNotMatch(runtimeContext, /system|instructions|必须|安全边界/);

const nurseryServiceSource = fs.readFileSync(
    require.resolve("../services/nursery"),
    "utf8"
);
const nurseryEventSource = fs.readFileSync(
    require.resolve("../services/nursery-events"),
    "utf8"
);
const contextSource = fs.readFileSync(
    require.resolve("../services/context-reset"),
    "utf8"
);
const serverSource = fs.readFileSync(
    require.resolve("../server"),
    "utf8"
);
for (const source of [nurseryServiceSource, nurseryEventSource]) {
    assert.doesNotMatch(
        source,
        /\.from\("(?:settings|memories)"\)|unified_system_prompt|user_details/
    );
    assert.doesNotMatch(
        source,
        /generateReply|chat\/completions|embeddings|api[_-]?key|fetch\(/i
    );
}
assert.match(contextSource, /isNurseryRelevant/);
assert.match(contextSource, /loadNurseryRuntimeSnapshot/);
assert.match(serverSource, /buildNurseryRuntimeContext\(context\.nursery, userMessage\)/);
assert.match(
    serverSource,
    /buildNurseryRuntimeContext\([\s\S]*?context\.nursery,[\s\S]*?voiceAnalysis\.text/
);
assert.match(serverSource, /nursery_provider_calls_per_action: 0/);
assert.match(serverSource, /nursery_dynamic_context_max_chars: 800/);

console.log("zero-provider nursery engine tests passed");
