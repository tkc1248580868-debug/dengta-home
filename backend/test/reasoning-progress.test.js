const assert = require("node:assert/strict");

const { generateReplyStream } = require("../services/ai-service");

const settings = {
    ai_name: "小灯",
    intimate_expression_enabled: true,
    unified_system_prompt: "说话自然、亲近、有一点调皮，但不要机械重复。"
};

async function streamedPublicReasoning(message) {
    const events = [];
    await generateReplyStream({
        settings: {
            ...settings,
            provider: "custom",
            model: ""
        },
        messages: [{ role: "user", content: message }],
        onEvent: (event) => events.push(event)
    });
    return events.filter((event) => event.type === "reasoning");
}

async function main() {
    const streamedQuestion = await streamedPublicReasoning(
        "为什么天气卡又被聊天内容盖住了？"
    );
    const streamedAffection = await streamedPublicReasoning(
        "小灯，我刚才有点想你。"
    );
    assert.deepEqual(streamedQuestion, []);
    assert.deepEqual(streamedAffection, []);
    assert.equal(
        [...streamedQuestion, ...streamedAffection].some(
            (event) => event.source === "companion_progress"
        ),
        false,
        "应用生成的固定文案不得再伪装成模型公开推理摘要"
    );
    console.log("reasoning progress tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
