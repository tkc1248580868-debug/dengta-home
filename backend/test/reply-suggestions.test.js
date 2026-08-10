const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { publicMessage } = require("../services/chat-attachments");
const {
    publicAssistantMessageWithSpeechAccess
} = require("../services/expressive-speech-access");
const { streamSuccess } = require("../services/chat-stream-contract");
const {
    REPLY_SUGGESTION_MAX_CHARS,
    SELECT_REPLY_SUGGESTIONS_TOOL,
    cleanReplySuggestion,
    createReplySuggestionSelector,
    finalizeReplySuggestions,
    normalizeReplySuggestions,
    parseReplySuggestionToolArguments,
    replySuggestionToolCalls
} = require("../services/reply-suggestions");

assert.equal(
    SELECT_REPLY_SUGGESTIONS_TOOL.name,
    "select_reply_suggestions"
);
assert.equal(
    SELECT_REPLY_SUGGESTIONS_TOOL.input_schema.properties.suggestions.minItems,
    2
);
assert.equal(
    SELECT_REPLY_SUGGESTIONS_TOOL.input_schema.properties.suggestions.maxItems,
    2
);
assert.equal(
    SELECT_REPLY_SUGGESTIONS_TOOL.input_schema.properties.suggestions.items
        .maxLength,
    REPLY_SUGGESTION_MAX_CHARS
);
assert.match(SELECT_REPLY_SUGGESTIONS_TOOL.description, /上下文不足/);
assert.match(SELECT_REPLY_SUGGESTIONS_TOOL.description, /请不要调用/);
assert.match(SELECT_REPLY_SUGGESTIONS_TOOL.description, /用户接下来可能/);
assert.match(SELECT_REPLY_SUGGESTIONS_TOOL.description, /即将给出的 AI 文字回复/);

assert.equal(
    cleanReplySuggestion("\u0000  选项 A： \u202e抱抱你\n一下  "),
    "抱抱你 一下"
);
assert.equal(
    Array.from(cleanReplySuggestion("想".repeat(100))).length,
    REPLY_SUGGESTION_MAX_CHARS
);
assert.deepEqual(
    normalizeReplySuggestions(["  好呀，过来吧  ", "B. 先哄哄我"]),
    ["好呀，过来吧", "先哄哄我"]
);
for (const invalid of [
    [],
    ["只有一条"],
    ["一", "二", "三"],
    ["一样", "一样！"],
    ["A. 好呀", "B. 好呀！"],
    ["", "另一条"],
    [null, "另一条"]
]) {
    assert.deepEqual(normalizeReplySuggestions(invalid), []);
}

assert.deepEqual(
    parseReplySuggestionToolArguments(
        '{"suggestions":["那就抱一下","先说说你有多想我"]}'
    ),
    {
        ok: true,
        value: ["那就抱一下", "先说说你有多想我"]
    }
);
for (const invalid of [
    "not-json",
    "[]",
    '{"suggestions":["只有一条"]}',
    '{"suggestions":["一样","一样。"]}',
    '{"suggestions":["一","二"],"extra":true}'
]) {
    assert.equal(parseReplySuggestionToolArguments(invalid).ok, false);
}

assert.deepEqual(
    finalizeReplySuggestions({
        recentMessages: [],
        assistantText: "你愿意陪我把今天的计划写完吗？",
        candidate: [
            "愿意，我陪你写完今天的计划",
            "今天先休息，明天再写计划"
        ],
        previousSuggestions: []
    }),
    [],
    "suggestions require a recent user turn"
);

const contextualReplySuggestions = [
    "愿意，我们一起去海边看日落",
    "我更想去山里，换一条旅行路线"
];
assert.deepEqual(
    finalizeReplySuggestions({
        recentMessages: [
            {
                role: "user",
                content: "明天的旅行路线还没定，你更想去海边还是山里？"
            }
        ],
        assistantText: "我更想去海边。你愿意和我一起看日落吗？",
        candidate: contextualReplySuggestions,
        previousSuggestions: []
    }),
    contextualReplySuggestions,
    "two context-linked replies survive the finalization gate"
);

const shortActionReplySuggestions = [
    "抱抱小乖乖",
    "才不要呢臭男人"
];
assert.deepEqual(
    finalizeReplySuggestions({
        recentMessages: [
            {
                role: "user",
                content: "你回来以后最想做什么？"
            }
        ],
        assistantText: "我喝醉了，回来就想让你抱我。",
        candidate: shortActionReplySuggestions,
        previousSuggestions: []
    }),
    shortActionReplySuggestions,
    "one strong short action anchor can support two different reply directions"
);
assert.deepEqual(
    finalizeReplySuggestions({
        recentMessages: [
            {
                role: "user",
                content: "你回来以后最想做什么？"
            }
        ],
        assistantText: "我喝醉了，回来就想让你抱我。",
        candidate: shortActionReplySuggestions,
        previousSuggestions: [
            "才不要呢臭男人！",
            "抱抱小乖乖。"
        ]
    }),
    [],
    "a short contextual pair is still hidden when it repeats consecutively"
);

assert.deepEqual(
    finalizeReplySuggestions({
        recentMessages: [
            {
                role: "user",
                content: "明天的旅行路线还没定，你更想去海边还是山里？"
            }
        ],
        assistantText: "我更想去海边。你愿意和我一起看日落吗？",
        candidate: ["好，我在认真听", "哼，那你再哄哄我"],
        previousSuggestions: []
    }),
    [],
    "generic replies without lexical relation to this turn are hidden"
);

assert.deepEqual(
    finalizeReplySuggestions({
        recentMessages: [
            {
                role: "user",
                content: "标准气压下水的沸点是多少？"
            }
        ],
        assistantText: "标准气压下，水的沸点是 100 摄氏度。",
        candidate: [
            "我记住水的沸点是 100 摄氏度",
            "请再解释一次标准气压和沸点"
        ],
        previousSuggestions: []
    }),
    [],
    "a related factual answer without a dialogue action does not show choices"
);

assert.deepEqual(
    finalizeReplySuggestions({
        recentMessages: [
            {
                role: "user",
                content: "明天的旅行路线还没定，你更想去海边还是山里？"
            }
        ],
        assistantText: "我更想去海边。你愿意和我一起看日落吗？",
        candidate: contextualReplySuggestions,
        previousSuggestions: [
            "我更想去山里，换一条旅行路线。",
            "愿意，我们一起去海边看日落！"
        ]
    }),
    [],
    "the same suggestion pair cannot be reused on consecutive turns"
);

async function main() {
    const untouched = createReplySuggestionSelector();
    assert.deepEqual(untouched.getSuggestions(), []);
    assert.deepEqual(replySuggestionToolCalls(untouched), {});

    const selector = createReplySuggestionSelector();
    const unknown = await selector.executeTool({
        name: "not_the_reply_suggestion_tool",
        arguments: "{}"
    });
    assert.equal(unknown.ok, false);
    const selected = await selector.executeTool({
        name: SELECT_REPLY_SUGGESTIONS_TOOL.name,
        arguments: JSON.stringify({
            suggestions: ["过来，让我抱一下", "才不要，先哄哄我"]
        })
    });
    assert.equal(selected.ok, true);
    assert.deepEqual(selected.reply_suggestions, [
        "过来，让我抱一下",
        "才不要，先哄哄我"
    ]);
    assert.deepEqual(replySuggestionToolCalls(selector), {
        reply_suggestions: ["过来，让我抱一下", "才不要，先哄哄我"]
    });
    const duplicateCall = await selector.executeTool({
        name: SELECT_REPLY_SUGGESTIONS_TOOL.name,
        arguments: JSON.stringify({
            suggestions: ["换一条", "再换一条"]
        })
    });
    assert.equal(duplicateCall.ok, false);
    assert.deepEqual(selector.getSuggestions(), [
        "过来，让我抱一下",
        "才不要，先哄哄我"
    ]);

    const storedAssistant = {
        id: "65",
        role: "assistant",
        content: "回来就抱抱你。",
        created_at: "2026-07-24T12:00:00.000Z",
        tool_calls: {
            reply_suggestions: [
                "\u0000A. 那你抱紧一点",
                "B：先说你有没有想我"
            ],
            internal_prompt: "must-not-leak"
        }
    };
    const publicAssistant = publicMessage(storedAssistant);
    assert.deepEqual(publicAssistant.tool_calls, {
        reply_suggestions: ["那你抱紧一点", "先说你有没有想我"]
    });
    assert.doesNotMatch(JSON.stringify(publicAssistant), /internal_prompt|leak/);

    const conversationId = "11111111-1111-4111-8111-111111111111";
    const withSpeechAccess = publicAssistantMessageWithSpeechAccess(
        publicAssistant,
        conversationId,
        { EXPRESSIVE_TTS_ACCESS_SECRET: "x".repeat(32) },
        Date.parse("2026-07-24T12:00:00.000Z")
    );
    assert.deepEqual(withSpeechAccess.tool_calls.reply_suggestions, [
        "那你抱紧一点",
        "先说你有没有想我"
    ]);
    assert.match(withSpeechAccess.speech_token, /^v1\./);

    const streamed = streamSuccess({
        assistant_message: withSpeechAccess
    });
    assert.equal(streamed.type, "done");
    assert.equal(streamed.ok, true);
    assert.deepEqual(
        streamed.assistant_message.tool_calls.reply_suggestions,
        publicAssistant.tool_calls.reply_suggestions
    );

    const invalidStored = publicMessage({
        ...storedAssistant,
        id: "66",
        tool_calls: { reply_suggestions: ["只有一条"] }
    });
    assert.equal(Object.hasOwn(invalidStored, "tool_calls"), false);
    const userMetadataIsNotPublic = publicMessage({
        ...storedAssistant,
        id: "67",
        role: "user"
    });
    assert.equal(
        Object.hasOwn(userMetadataIsNotPublic, "tool_calls"),
        false
    );

    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    assert.match(serverSource, /SELECT_REPLY_SUGGESTIONS_TOOL/);
    assert.match(
        serverSource,
        /dynamic_reply_suggestions:\s*true/
    );
    assert.equal(
        (
            serverSource.match(
                /finalizeReplySuggestions\(\{[\s\S]{0,500}?recentMessages:\s*context\.messages[\s\S]{0,500}?assistantText:\s*generated\.text[\s\S]{0,500}?candidate:\s*chatTools\.getReplySuggestions\(\)[\s\S]{0,500}?previousSuggestions:/g
            ) || []
        ).length,
        2,
        "text and voice turns finalize contextual suggestions before persistence"
    );
    assert.equal(
        (
            serverSource.match(
                /replySuggestionToolCalls\(\s*finalizedReplySuggestions\s*\)/g
            ) || []
        ).length,
        2
    );
    assert.match(
        serverSource,
        /replayCommittedChatTurn[\s\S]*?publicAssistantMessage\(/
    );
    assert.match(
        serverSource,
        /writeSse\(res,\s*streamSuccess\(result\)\)/
    );
    assert.match(
        serverSource,
        /app\.post\(\s*"\/voice\/turn"[\s\S]*?SELECT_REPLY_SUGGESTIONS_TOOL/
    );

    console.log(
        "dynamic reply suggestion tool, persistence and public contract tests passed"
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
