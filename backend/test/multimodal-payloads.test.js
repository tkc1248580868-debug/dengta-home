const assert = require("node:assert/strict");
const {
    buildAnthropicMessages,
    buildGeminiContents,
    buildOpenAiMessages
} = require("../services/ai-service");

const messages = [
    { role: "user", content: "旧问题" },
    { role: "assistant", content: "旧回答" },
    { role: "user", content: "请看这张图" }
];
const attachments = [{ mimeType: "image/png", data: "aGVsbG8=" }];

const openAi = buildOpenAiMessages(messages, ["最高规则"], attachments);
assert.equal(openAi[0].role, "system");
assert.equal(typeof openAi[1].content, "string");
assert.ok(Array.isArray(openAi[3].content));
assert.equal(openAi[3].content[1].type, "image_url");
assert.match(openAi[3].content[1].image_url.url, /^data:image\/png;base64,/);

const gemini = buildGeminiContents(messages, attachments);
assert.equal(gemini[0].parts.length, 1);
assert.equal(gemini[2].parts[1].inlineData.mimeType, "image/png");

const anthropic = buildAnthropicMessages(messages, attachments);
assert.equal(typeof anthropic[0].content, "string");
assert.equal(anthropic[2].content[1].type, "image");
assert.equal(anthropic[2].content[1].source.type, "base64");

console.log("provider multimodal payload tests passed");
