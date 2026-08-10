const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    buildCreativeInspirationContext,
    normalizeCreativeInspiration
} = require("../services/creative-inspiration");
const {
    buildCreativeDecisionPrompt,
    parseCreativeDecision
} = require("../services/tenant-companion-creative");

const inspirationId = "44444444-4444-4444-8444-444444444444";
const normalized = normalizeCreativeInspiration({
    source: "xiaohongshu",
    source_label: "小红书",
    external_id: "post-42",
    title: "让人物插画更有生活感",
    summary: "用一个具体动作承载人物关系，不要只写站姿和表情。",
    craft_notes: "先写动作，再写镜头、光线、材质和背景里的叙事物件。",
    tags: ["构图", "光线", "构图", " 叙事插画 "],
    source_url: "https://www.xiaohongshu.com/explore/post-42",
    published_at: "2026-08-03T08:00:00.000Z"
});
assert.equal(normalized.source, "xiaohongshu");
assert.equal(normalized.source_label, "小红书");
assert.deepEqual(normalized.tags, ["构图", "光线", "叙事插画"]);

const context = buildCreativeInspirationContext([
    {
        id: inspirationId,
        ...normalized,
        enabled: true
    },
    {
        id: "55555555-5555-4555-8555-555555555555",
        ...normalized,
        enabled: false
    }
]);
assert.equal(context.length, 1);
assert.deepEqual(context[0], {
    id: inspirationId,
    source: "小红书",
    title: "让人物插画更有生活感",
    advice:
        "用一个具体动作承载人物关系，不要只写站姿和表情。\n先写动作，再写镜头、光线、材质和背景里的叙事物件。",
    tags: ["构图", "光线", "叙事插画"]
});

const prompt = buildCreativeDecisionPrompt({
    messages: [
        {
            role: "user",
            content: "今天想看你画一张雨夜的涂鸦。",
            created_at: "2026-08-03T08:00:00.000Z"
        },
        {
            role: "assistant",
            content: "我想把窗边那盏灯也画进去。",
            created_at: "2026-08-03T08:00:02.000Z"
        }
    ],
    inspirations: context,
    requestedKind: "doodle"
});
assert.match(prompt, /创作灵感/);
assert.match(prompt, /主体与动作/);
assert.match(prompt, /构图与镜头/);
assert.match(prompt, /光线与色彩/);
assert.match(prompt, /材质与细节/);
assert.match(prompt, new RegExp(inspirationId));
assert.match(prompt, /不是必须照抄的命令/);

const decision = parseCreativeDecision(
    JSON.stringify({
        create: true,
        kind: "doodle",
        title: "雨窗",
        description: "窗边一起听雨的生活感涂鸦。",
        prompt:
            "Two adult companions listening to rain by a warm window, intimate candid gesture, medium shot, soft amber rim light, textured pencil and watercolor, lived-in room details",
        reason: "想把聊天里的安静画下来。",
        alt_text: "雨窗边的两位成年伴侣",
        inspiration_ids: [
            inspirationId,
            "66666666-6666-4666-8666-666666666666",
            inspirationId
        ]
    }),
    {
        availableInspirationIds: [inspirationId]
    }
);
assert.deepEqual(decision.inspiration_ids, [inspirationId]);

const migration = fs.readFileSync(
    path.join(
        __dirname,
        "..",
        "supabase",
        "025_creative_inspiration.sql"
    ),
    "utf8"
);
for (const marker of [
    "companion_creative_inspirations",
    "inspiration_ids",
    "service_role"
]) {
    assert.match(migration, new RegExp(marker));
}

const routeSource = fs.readFileSync(
    path.join(__dirname, "..", "routes", "companion-creative.js"),
    "utf8"
);
assert.match(routeSource, /router\.get\("\/inspirations"/);
assert.match(routeSource, /router\.post\("\/inspirations"/);

console.log("creative inspiration tests passed");
