import assert from "node:assert/strict";
import fs from "node:fs";
import { streamChat } from "../src/api.js";
import {
  CHAT_ERROR_FALLBACK,
  COMMITTED_CHAT_ERROR_FALLBACK,
  dismissChatErrorMessage,
  isProviderErrorDocument,
  publicChatErrorMessage,
} from "../src/chat-errors.js";
import { hydrateChatMessage } from "../src/chat-history.js";

assert.equal(
  publicChatErrorMessage("<html><pre>provider stack</pre></html>"),
  CHAT_ERROR_FALLBACK,
);
assert.equal(
  publicChatErrorMessage('{"error":{"message":"raw provider response"}}'),
  CHAT_ERROR_FALLBACK,
);
assert.equal(
  publicChatErrorMessage("Authorization: Bearer secret-provider-token"),
  CHAT_ERROR_FALLBACK,
);
assert.equal(publicChatErrorMessage("模型接口等待超时，请稍后重试。"), "模型接口等待超时，请稍后重试。");

assert.deepEqual(
  dismissChatErrorMessage(
    [
      { id: "user", role: "user", content: "原消息" },
      { id: "error", role: "assistant", content: "错误", chatError: true },
    ],
    "error",
  ),
  [{ id: "user", role: "user", content: "原消息" }],
);

assert.equal(
  isProviderErrorDocument(
    '<!doctype html><html><body><pre>gateway denied</pre></body></html>',
  ),
  true,
);
assert.equal(
  isProviderErrorDocument('{"error":{"message":"gateway denied"}}'),
  true,
);
assert.equal(isProviderErrorDocument('<div class="example">hello</div>'), false);
assert.equal(isProviderErrorDocument('{"answer":"ok","status":200}'), false);
assert.equal(
  isProviderErrorDocument("```html\n<!doctype html>\n<p>example</p>\n```"),
  false,
);

assert.deepEqual(
  hydrateChatMessage({
    id: "stored-provider-document",
    role: "assistant",
    content: "<!doctype html><html><body>gateway denied</body></html>",
  }),
  {
    id: "stored-provider-document",
    role: "assistant",
    content: COMMITTED_CHAT_ERROR_FALLBACK,
    thinkingStatuses: [],
    chatError: true,
    generationInProgress: false,
    isStreaming: false,
    retryAvailable: true,
  },
);

const chatMessageSource = fs.readFileSync(
  new URL("../src/ChatMessage.jsx", import.meta.url),
  "utf8",
);
assert.match(chatMessageSource, /aria-label="关闭这条错误提示"/);
assert.match(chatMessageSource, /onDismissError\(item\.id\)/);

async function streamWithEvents(events, onEvent = () => {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let readCount = 0;

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader() {
        return {
          async read() {
            readCount += 1;
            if (readCount > 1) return { done: true, value: undefined };
            return {
              done: false,
              value: new TextEncoder().encode(
                events
                  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                  .join(""),
              ),
            };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  });

  try {
    return await streamChat({}, onEvent);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

await assert.rejects(
  streamWithEvents([
    {
      type: "error",
      code: "provider_error",
      content:
        "<!doctype html><html><body><pre>UPSTREAM_POLICY_DENIED stack=abc</pre></body></html>",
    },
  ]),
  (error) => {
    assert.equal(error.message, "模型服务暂时无法完成这次回复，请稍后重试。");
    assert.doesNotMatch(
      error.message,
      /<!doctype|<html|<pre>|UPSTREAM_POLICY_DENIED|stack=/i,
    );
    return true;
  },
);

{
  const visibleEvents = [];
  const error = await streamWithEvents(
    [
      {
        type: "text",
        content:
          "<!doctype html><html><body><pre>403 UPSTREAM_POLICY_DENIED stack=abc</pre></body></html>",
      },
    ],
    (event) => visibleEvents.push(event),
  ).then(
    () => null,
    (reason) => reason,
  );
  assert.equal(
    visibleEvents.some((event) => /<!doctype|<html|<pre>|stack=/i.test(event.content || "")),
    false,
    "provider error documents must never reach the visible assistant stream",
  );
  assert.equal(error?.message, CHAT_ERROR_FALLBACK);
}

{
  const visibleEvents = [];
  const error = await streamWithEvents(
    [
      { type: "meta", user_message: { id: "saved-user" } },
      { type: "text", content: "<!doc" },
      {
        type: "text",
        content: "type html><html><body><pre>gateway denied</pre></body></html>",
      },
      { type: "done", ok: true },
    ],
    (event) => visibleEvents.push(event),
  ).then(
    () => null,
    (reason) => reason,
  );
  assert.equal(
    visibleEvents.some((event) =>
      /<!doc|<html|<pre>|gateway/i.test(event.content || ""),
    ),
    false,
  );
  assert.equal(error?.message, COMMITTED_CHAT_ERROR_FALLBACK);
}

for (const fragments of [
  ["<di", 'v class="example">hello</div>'],
  ['{"answer":', '"ok","status":200}'],
  ["```html\n<!doctype html>\n", "<p>example</p>\n```"],
]) {
  const visibleEvents = [];
  const expected = fragments.join("");
  await streamWithEvents(
    [
      ...fragments.map((content) => ({ type: "text", content })),
      { type: "done", ok: true },
    ],
    (event) => visibleEvents.push(event),
  );
  assert.equal(
    visibleEvents
      .filter((event) => event.type === "text")
      .map((event) => event.content)
      .join(""),
    expected,
  );
}

console.log("chat error sanitization tests passed");
