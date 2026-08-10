const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    appendShadowUserTrigger,
    buildShadowMemoryText,
    buildShadowUserContent,
    cleanPushReply,
    decideShadowPush,
    getZonedClock
} = require("../services/shadow-push");

const clock = getZonedClock(
    new Date("2026-07-21T10:30:00.000Z"),
    "Asia/Shanghai"
);
const memories = [
    { summary: "用户最近在准备一个重要项目，昨天聊到需要慢慢收尾。" }
];
const shadowUserContent = buildShadowUserContent({
    clock,
    memories,
    momentsText: "AI 刚刚发了一条安静的生活动态。"
});

assert.match(shadowUserContent, /^<system_trigger>/);
assert.match(shadowUserContent, /<\/system_trigger>$/);
assert.match(shadowUserContent, /当前真实时间/);
assert.match(shadowUserContent, /用户当前状态参考/);
assert.match(shadowUserContent, /最近对话摘要 \/ 长期记忆/);
assert.match(shadowUserContent, /重要项目/);
assert.match(shadowUserContent, /近期动态氛围/);
assert.match(shadowUserContent, /\[行动指令\]/);
assert.match(shadowUserContent, /只写 1 到 2 句/);
assert.match(shadowUserContent, /不要每次都围绕/);
assert.equal(
    buildShadowMemoryText([{ summary: "sk-abcdefghijk" }]).includes(
        "sk-abcdefghijk"
    ),
    false,
    "记忆中的疑似密钥不能进入影子请求"
);

const originalHistory = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `真实消息 ${index + 1}`
}));
const historySnapshot = structuredClone(originalHistory);
const pushMessages = appendShadowUserTrigger(
    originalHistory,
    shadowUserContent
);

assert.deepEqual(
    originalHistory,
    historySnapshot,
    "拼影子请求不能污染真实历史数组"
);
assert.equal(pushMessages.length, 17, "只保留最近 16 条真实历史并追加一条影子 user");
assert.deepEqual(pushMessages[0], originalHistory[4]);
assert.deepEqual(pushMessages.at(-1), {
    role: "user",
    content: shadowUserContent
});

const longReply = `${"这是一句完整的话。".repeat(20)}最后。`;
const cleanedReply = cleanPushReply(longReply);
assert.ok(Array.from(cleanedReply).length <= 120);
assert.match(cleanedReply, /[。！？]$/u, "长推送应在句末标点处软截断");

const blockedAtNight = decideShadowPush({
    now: new Date("2026-07-20T18:00:00.000Z"),
    timezone: "Asia/Shanghai",
    maxPushPerDay: 7,
    cooldownMinutes: 120
});
assert.equal(blockedAtNight.shouldPush, false);
assert.equal(blockedAtNight.reason, "weekday_sleep");

const serverSource = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);
const shadowFunctionStart = serverSource.indexOf(
    "async function generateShadowPush"
);
const shadowFunctionEnd = serverSource.indexOf(
    "\nfunction chatAttachmentOptions",
    shadowFunctionStart
);
assert.notEqual(shadowFunctionStart, -1);
assert.notEqual(shadowFunctionEnd, -1);
const shadowFunctionSource = serverSource.slice(
    shadowFunctionStart,
    shadowFunctionEnd
);

assert.match(shadowFunctionSource, /buildShadowUserContent/);
assert.match(shadowFunctionSource, /appendShadowUserTrigger/);
assert.match(shadowFunctionSource, /messages:\s*pushMessages/);
assert.match(shadowFunctionSource, /memories:\s*\[\]/);
assert.match(shadowFunctionSource, /runtimeContext:\s*""/);
assert.match(
    shadowFunctionSource,
    /saveMessage\(\s*context\.conversation\.id,\s*"assistant"/s,
    "只有生成的 assistant 推送可以落库"
);
assert.doesNotMatch(
    shadowFunctionSource,
    /saveMessage\([^;]*["']user["']/s,
    "影子 user 只能存在于模型请求体，绝不能写入数据库"
);
assert.match(shadowFunctionSource, /is_push:\s*true/);

console.log("shadow push user-trigger tests passed");
