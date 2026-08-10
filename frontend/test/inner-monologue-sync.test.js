import assert from "node:assert/strict";
import {
  findSynchronizedAssistantMessage,
  isSynchronizedChatMessage,
  recoverSynchronizedAssistantMessage,
} from "../src/inner-monologue-sync.js";

const localMessage = {
  id: "local-assistant-1723170000000",
  role: "assistant",
  content: "刚刚生成、已经看得到的回复",
  created_at: "2026-08-09T09:00:00.000Z",
};
const synchronizedMessage = {
  id: "019c0000-0000-7000-8000-000000000001",
  role: "assistant",
  content: localMessage.content,
  created_at: "2026-08-09T09:00:02.000Z",
};

assert.equal(isSynchronizedChatMessage(localMessage), false);
assert.equal(isSynchronizedChatMessage(synchronizedMessage), true);
assert.equal(
  findSynchronizedAssistantMessage(localMessage, [
    {
      id: "019c0000-0000-7000-8000-000000000002",
      role: "assistant",
      content: "另一条回复",
      created_at: "2026-08-09T08:59:58.000Z",
    },
    synchronizedMessage,
  ])?.id,
  synchronizedMessage.id,
);
assert.equal(
  (
    await recoverSynchronizedAssistantMessage({
      message: localMessage,
      sessionId: "",
    })
  ).error,
  "回复同步中，请稍后再试。",
);
assert.equal(
  findSynchronizedAssistantMessage(synchronizedMessage, [])?.id,
  synchronizedMessage.id,
);

assert.equal(
  (
    await recoverSynchronizedAssistantMessage({
      message: localMessage,
      sessionId: "11111111-1111-4111-8111-111111111111",
      loadMessages: async () => [synchronizedMessage],
    })
  ).message?.id,
  synchronizedMessage.id,
);

console.log("inner monologue synchronization recovery checks passed");
