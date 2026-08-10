const assert = require("node:assert/strict");
const {
    VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE,
    parseVisibleInnerMonologueRequest,
    runVisibleInnerMonologue
} = require("../services/visible-inner-monologue");

const sessionId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const uuidV7MessageId = "019c0000-0000-7000-8000-000000000001";

const parsed = parseVisibleInnerMonologueRequest({
    session_id: sessionId,
    message_id: messageId,
    model: "gpt-5.6-sol",
    companion_status: {
        mood: "疲惫",
        energyLevel: 1,
        pulseBpm: 72,
        focus: "想休息"
    }
});
assert.equal(parsed.conversationId, sessionId);
assert.equal(parsed.messageId, messageId);
assert.equal(parsed.requestedModel, "gpt-5.6-sol");
assert.equal(
    parseVisibleInnerMonologueRequest({
        session_id: sessionId,
        message_id: uuidV7MessageId
    }).messageId,
    uuidV7MessageId
);

async function main() {
    let generationInput;
    let saveCalled = false;
    const result = await runVisibleInnerMonologue({
        body: {
            session_id: sessionId,
            message_id: messageId,
            model: "gpt-5.6-sol",
            companion_status: {
                mood: "疲惫",
                energyLevel: 1,
                pulseBpm: 72,
                focus: "想休息"
            }
        },
        services: {
            async loadMessage(conversationId, targetMessageId) {
                assert.equal(conversationId, sessionId);
                assert.equal(targetMessageId, messageId);
                return {
                    id: messageId,
                    conversation_id: sessionId,
                    role: "assistant",
                    visible: true,
                    content: "我陪你慢慢说。"
                };
            },
            async getSettings() {
                return {
                    prompt_mode: "unified",
                    unified_system_prompt:
                        "## [Thinking Block]\n至少800字符，以第一人称写内心独白。",
                    user_details: "我叫洋洋，对方叫桃桃。",
                    provider: "openai-responses",
                    model: "gpt-5.6-sol",
                    max_tokens: 900
                };
            },
            async loadChatContext() {
                return {
                    messages: [
                        { role: "user", content: "你累不累？" },
                        { role: "assistant", content: "我陪你慢慢说。" }
                    ],
                    memories: [{ summary: "我记得桃桃喜欢听我说真心话。" }]
                };
            },
            async resolveTurnModel(settings, requestedModel) {
                assert.equal(settings.model, "gpt-5.6-sol");
                assert.equal(requestedModel, "gpt-5.6-sol");
                return requestedModel;
            },
            async generateReply(input) {
                generationInput = input;
                return {
                    text: "我现在很累，但最想让桃桃抱抱我，然后一起安静听歌。".repeat(40),
                    mode: "openai-responses"
                };
            },
            async saveMessage() {
                saveCalled = true;
            }
        }
    });

    assert.equal(result.message_id, messageId);
    assert.equal(result.model, "gpt-5.6-sol");
    assert.ok(result.inner_monologue.length >= 800);
    assert.equal(saveCalled, false, "visible monologue must not enter chat history");
    assert.equal(
        generationInput.promptArchitecture,
        VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE
    );
    assert.equal(generationInput.settings.reasoning_effort, "medium");
    assert.equal(generationInput.settings.max_tokens, 3000);
    assert.equal(generationInput.settings.request_timeout_ms, 120000);
    assert.match(generationInput.runtimeContext, /能量：1%/);
    assert.match(generationInput.runtimeContext, /我陪你慢慢说/);
    assert.match(
        generationInput.messages.at(-1).content,
        /只输出这一次可见心声正文/
    );

    console.log("visible inner monologue checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
