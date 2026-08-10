const assert = require("node:assert/strict");
const http = require("node:http");
const { generateReplyStream } = require("../services/ai-service");

function sendDelta(response, content) {
    response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
    );
}

async function withProviderStream(fragments, run) {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });
        for (const fragment of fragments) sendDelta(response, fragment);
        response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
        const { port } = server.address();
        await run(`http://127.0.0.1:${port}/v1`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

async function generateFromFragments(fragments) {
    let result;
    let error;
    const events = [];

    await withProviderStream(fragments, async (apiUrl) => {
        try {
            result = await generateReplyStream({
                settings: {
                    provider: "custom",
                    api_url: apiUrl,
                    runtime_api_key: "local-test-key",
                    model: "mock-model",
                    temperature: 0.2,
                    max_tokens: 200
                },
                messages: [{ role: "user", content: "test" }],
                onEvent(event) {
                    events.push(event);
                }
            });
        } catch (reason) {
            error = reason;
        }
    });

    return { result, error, events };
}

function visibleText(events) {
    return events
        .filter((event) => event.type === "text")
        .map((event) => event.content || "")
        .join("");
}

async function assertProviderDocumentBlocked(fragments) {
    const { result, error, events } = await generateFromFragments(fragments);
    assert.equal(result, undefined);
    assert.equal(error?.code, "provider_error_document");
    assert.doesNotMatch(
        visibleText(events),
        /<!doctype|<html|<pre>|UPSTREAM_POLICY_DENIED|stack=|gateway/i
    );
}

async function assertNormalAnswerPreserved(fragments, expected) {
    const { result, error, events } = await generateFromFragments(fragments);
    assert.equal(error, undefined);
    assert.equal(result.text, expected);
    assert.equal(visibleText(events), expected);
}

async function main() {
    await assertProviderDocumentBlocked([
        "<!doc",
        "type html><html><body><pre>403 UPSTREAM_POLICY_DENIED ",
        "stack=abc</pre></body></html>"
    ]);
    await assertProviderDocumentBlocked([
        '{"error":',
        '{"message":"gateway denied","code":"policy_denied"}}'
    ]);

    await assertNormalAnswerPreserved(
        ["<di", 'v class="example">hello</div>'],
        '<div class="example">hello</div>'
    );
    await assertNormalAnswerPreserved(
        ['{"answer":', '"ok","status":200}'],
        '{"answer":"ok","status":200}'
    );
    await assertNormalAnswerPreserved(
        ["```html\n<!doctype html>\n", "<p>example</p>\n```"],
        "```html\n<!doctype html>\n<p>example</p>\n```"
    );

    console.log("provider output guard tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
