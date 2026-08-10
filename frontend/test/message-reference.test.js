import assert from "node:assert/strict";
import {
  MESSAGE_REFERENCE_TEXT_LIMIT,
  applyStoredMessageReferences,
  attachMessageReference,
  clearStoredMessageReferencesForSession,
  createMessageReference,
  longPressMovementExceeded,
  messageCanBeReferenced,
  messageReferenceFromMessage,
  normalizeMessageReference,
  storeMessageReferenceForMessage,
} from "../src/message-reference.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const reference = createMessageReference({
  id: 42,
  role: "assistant",
  content: `  ${"想".repeat(MESSAGE_REFERENCE_TEXT_LIMIT + 8)}  `,
  attachments: [
    { name: "自拍.jpg", media_type: "image/jpeg" },
    { file: { name: "语音.m4a", type: "audio/mp4" } },
  ],
});
assert.equal(reference.message_id, "42");
assert.equal(reference.role, "assistant");
assert.equal(Array.from(reference.text).length, MESSAGE_REFERENCE_TEXT_LIMIT);
assert.equal(reference.text_truncated, true);
assert.deepEqual(reference.attachment_summary, {
  count: 2,
  items: [
    { name: "自拍.jpg", type: "image/jpeg" },
    { name: "语音.m4a", type: "audio/mp4" },
  ],
});

for (const invalidId of [
  "local-assistant-1720000000000",
  "11111111-1111-4111-8111-111111111111",
  "0",
  "9223372036854775808",
]) {
  assert.equal(
    createMessageReference({
      id: invalidId,
      role: "assistant",
      content: "temporary message",
    }),
    null,
    `message id ${invalidId} must never become a server-bound reference`,
  );
  assert.equal(
    normalizeMessageReference({
      message_id: invalidId,
      role: "assistant",
      text: "temporary message",
    }),
    null,
    `cached reference id ${invalidId} must be discarded`,
  );
}

assert.equal(messageCanBeReferenced({ ...reference, isStreaming: true }), false);
assert.equal(
  messageCanBeReferenced({
    id: "local-user-1720000000000",
    role: "user",
    content: "optimistic message",
  }),
  false,
);
assert.equal(
  messageCanBeReferenced({ id: "empty", role: "user", content: "" }),
  false,
);
assert.equal(normalizeMessageReference({ role: "user", text: "缺少 id" }), null);
assert.equal(longPressMovementExceeded(10, 10, 17, 17), false);
assert.equal(
  longPressMovementExceeded(10, 10, 24, 10),
  true,
  "a vertical or horizontal scroll gesture must cancel long press",
);

const attached = attachMessageReference(
  { id: "new", role: "user", content: "接着聊" },
  reference,
);
assert.deepEqual(messageReferenceFromMessage(attached), reference);

const storage = memoryStorage();
storeMessageReferenceForMessage("session-a", "saved-message", reference, storage);
const restored = applyStoredMessageReferences(
  [{ id: "saved-message", role: "user", content: "接着聊" }],
  "session-a",
  storage,
);
assert.deepEqual(messageReferenceFromMessage(restored[0]), reference);
assert.deepEqual(
  messageReferenceFromMessage(
    applyStoredMessageReferences(restored, "another-session", storage)[0],
  ),
  reference,
  "a server-provided snapshot must remain intact across hydration",
);
clearStoredMessageReferencesForSession("session-a", storage);
assert.equal(
  messageReferenceFromMessage(
    applyStoredMessageReferences(
      [{ id: "saved-message", role: "user", content: "接着聊" }],
      "session-a",
      storage,
    )[0],
  ),
  null,
);

console.log("message reference tests passed");
