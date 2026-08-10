const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
    buildCoWatchPrompt,
    normalizeCoWatchFrame,
    runCoWatchFrame
} = require("../services/co-watch");

async function main() {

const frame = normalizeCoWatchFrame({
    sessionId: "2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",
    epoch: "3",
    sequence: "7",
    capturedAt: "2026-08-03T02:30:00.000Z",
    mimeType: "image/jpeg"
});
assert.equal(frame.sequence, 7);
assert.equal(frame.capturedAt, "2026-08-03T02:30:00.000Z");
assert.match(buildCoWatchPrompt(frame), /一起看|真正想说/);
assert.throws(() => normalizeCoWatchFrame({ sessionId: "bad" }), /编号无效/);

const calls = [];
const database = { from() {} };
const result = await runCoWatchFrame({
    database,
    frame,
    image: Buffer.from("jpeg"),
    findReaction: async () => null,
    findConversation: async () => ({ id: "conversation-1" }),
    getSettings: async () => ({
        ai_name: "小灯",
        provider: "custom",
        model: "vision-model",
        temperature: 0.5,
        max_tokens: 900
    }),
    loadChatContext: async () => ({
        messages: [{ role: "user", content: "我们刚刚在选电影。" }],
        memories: [{ summary: "我喜欢和桃桃一起看悬疑片。" }]
    }),
    generateReply: async (input) => {
        calls.push(["generateReply", input]);
        return { text: "  这个镜头让我有点紧张，先别快进。  ", mode: "responses" };
    },
    saveMessage: async (...args) => {
        calls.push(["saveMessage", ...args]);
        return { id: "message-1" };
    },
    touchConversation: async (...args) => calls.push(["touch", ...args])
});
assert.equal(result.status, "created");
assert.equal(result.reaction, "这个镜头让我有点紧张，先别快进。");
const generation = calls.find((call) => call[0] === "generateReply")[1];
assert.equal(generation.promptArchitecture, "main-chat");
assert.equal(generation.attachments[0].data, Buffer.from("jpeg").toString("base64"));
assert.deepEqual(generation.memories, [
    { summary: "我喜欢和桃桃一起看悬疑片。" }
]);
const save = calls.find((call) => call[0] === "saveMessage");
assert.equal(save[1], "conversation-1");
assert.equal(save[2], "assistant");
assert.equal(save[4].tool_calls.is_push, true);
assert.equal(save[4].tool_calls.is_co_watch, true);
assert.equal(save[4].tool_calls.co_watch_sequence, 7);

let generatedAgain = false;
const replayed = await runCoWatchFrame({
    database,
    frame,
    image: Buffer.from("jpeg"),
    findReaction: async () => ({
        id: "message-1",
        conversation_id: "conversation-1",
        content: "已经生成过的反应"
    }),
    findConversation: async () => null,
    getSettings: async () => ({}),
    loadChatContext: async () => ({}),
    generateReply: async () => {
        generatedAgain = true;
    },
    saveMessage: async () => {},
    touchConversation: async () => {}
});
assert.equal(replayed.status, "replayed");
assert.equal(generatedAgain, false);

const serverSource = fs.readFileSync(
    new URL("../server.js", `file://${__filename.replace(/\\/g, "/")}`),
    "utf8"
);
const authSource = fs.readFileSync(
    new URL("../services/auth-context.js", `file://${__filename.replace(/\\/g, "/")}`),
    "utf8"
);
const routeSource = fs.readFileSync(
    new URL("../routes/co-watch.js", `file://${__filename.replace(/\\/g, "/")}`),
    "utf8"
);
assert.match(serverSource, /createCoWatchRouter/);
assert.match(serverSource, /"\/api\/v2\/co-watch"/);
assert.match(authSource, /path === "\/api\/v2\/co-watch\/frame"/);
assert.match(routeSource, /express\.raw/);
assert.match(routeSource, /MAX_FRAME_BYTES/);

console.log("co-watch frame, prompt, image and idempotency tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
