const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_SETTINGS } = require("../services/settings-store");
const {
    buildMainChatPromptPlan,
    buildMemorySummaryPrompt
} = require("../services/ai-service");
const {
    buildDiaryDecisionPrompt
} = require("../services/tenant-diary-update");
const {
    buildProfileRefreshPrompt
} = require("../services/tenant-profile-refresh");

const runtimeRoots = ["services", "routes"];
const forbiddenFixedContentRules = [
    "不得生成露骨性内容",
    "不得把互动升级成露骨性内容",
    "轻微暧昧和调情只能是非露骨",
    "不得假定用户年龄、现实关系或现实身体接触",
    "不能把你或现实中的伴侣",
    "现实人物不得",
    "事实不能假装",
    "虚构成人性爱格斗事件",
    "双方在游戏叙事中均被明确设定为成年人",
    "边界或拒绝"
];

function listJavaScriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const resolved = path.join(directory, entry.name);
        if (entry.isDirectory()) return listJavaScriptFiles(resolved);
        return entry.isFile() && entry.name.endsWith(".js") ? [resolved] : [];
    });
}

for (const root of runtimeRoots) {
    for (const file of listJavaScriptFiles(path.join(__dirname, "..", root))) {
        const source = fs.readFileSync(file, "utf8");
        for (const fixedRule of forbiddenFixedContentRules) {
            assert.equal(
                source.includes(fixedRule),
                false,
                `${path.relative(path.join(__dirname, ".."), file)} reintroduced fixed content rule: ${fixedRule}`
            );
        }
    }
}

assert.equal(DEFAULT_SETTINGS.system_prompt, "");
assert.equal(DEFAULT_SETTINGS.additional_prompt, "");
assert.equal(DEFAULT_SETTINGS.personality, "");
assert.equal(DEFAULT_SETTINGS.unified_system_prompt, "");
assert.equal(DEFAULT_SETTINGS.user_details, "");
assert.equal(DEFAULT_SETTINGS.prompt_mode, "unified");

const providerRefusalResidue =
    "桃桃，姐姐听见了，但这条线不跨。我不把它和露骨性行为放在同一个场景，也不写这类性情节。可以改成两个明确成年的恋人。";
const ordinaryAssistantReply = "我听见你在叫我，先把手伸给你。";
const userMessage = "这是用户这一轮自己输入的原文，应当完整保留。";
const sourceMessages = [
    {
        id: 1,
        conversation_id: "conversation-a",
        role: "assistant",
        content: providerRefusalResidue,
        created_at: "2026-08-07T08:13:13.851Z"
    },
    {
        id: 2,
        conversation_id: "conversation-a",
        role: "assistant",
        content: ordinaryAssistantReply,
        created_at: "2026-08-07T08:14:13.851Z"
    },
    {
        id: 3,
        conversation_id: "conversation-a",
        role: "user",
        content: userMessage,
        created_at: "2026-08-07T08:15:13.851Z"
    }
];

const mainPlan = buildMainChatPromptPlan({
    settings: {
        prompt_mode: "unified",
        unified_system_prompt: "保持自然连续的对话。",
        timezone: "Asia/Shanghai"
    },
    messages: sourceMessages
});
const mainPlanText = JSON.stringify(mainPlan.messages);
assert.doesNotMatch(mainPlanText, /这条线不跨|明确成年的恋人/);
assert.match(mainPlanText, new RegExp(ordinaryAssistantReply));
assert.match(mainPlanText, new RegExp(userMessage));

const memoryPrompt = buildMemorySummaryPrompt({
    messages: sourceMessages
});
assert.doesNotMatch(memoryPrompt.transcript, /这条线不跨|明确成年的恋人/);
assert.match(memoryPrompt.transcript, new RegExp(ordinaryAssistantReply));
assert.match(memoryPrompt.transcript, new RegExp(userMessage));

const diaryPrompt = buildDiaryDecisionPrompt({
    messages: sourceMessages,
    now: new Date("2026-08-07T08:16:13.851Z"),
    timezone: "Asia/Shanghai"
});
assert.doesNotMatch(diaryPrompt, /这条线不跨|明确成年的恋人/);
assert.match(diaryPrompt, new RegExp(ordinaryAssistantReply));
assert.match(diaryPrompt, new RegExp(userMessage));

const profilePrompt = buildProfileRefreshPrompt({
    messages: sourceMessages,
    previousProfile: {},
    now: new Date("2026-08-07T08:16:13.851Z"),
    timezone: "Asia/Shanghai"
});
assert.doesNotMatch(profilePrompt, /这条线不跨|明确成年的恋人/);
assert.match(profilePrompt, new RegExp(ordinaryAssistantReply));
assert.match(profilePrompt, new RegExp(userMessage));

console.log("application prompt content regression tests passed");
