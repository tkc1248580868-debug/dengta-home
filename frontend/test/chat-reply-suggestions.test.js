import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normalizeReplySuggestions,
  readReplySuggestions,
} from "../src/chat-reply-suggestions.js";

assert.deepEqual(
  normalizeReplySuggestions([
    "抱一下，再陪我坐一会儿",
    "先去喝点水，我在这里等你",
  ]),
  ["抱一下，再陪我坐一会儿", "先去喝点水，我在这里等你"],
);
assert.deepEqual(
  readReplySuggestions({
    role: "assistant",
    tool_calls: {
      reply_suggestions: ["  好，过来吧  ", "那你先认真哄哄我\n"],
    },
  }),
  ["好，过来吧", "那你先认真哄哄我"],
);
assert.deepEqual(readReplySuggestions({ role: "assistant" }), []);
assert.deepEqual(normalizeReplySuggestions([]), []);
assert.deepEqual(normalizeReplySuggestions(["只有一个"]), []);
assert.deepEqual(normalizeReplySuggestions(["一个", "两个", "三个"]), []);
assert.deepEqual(normalizeReplySuggestions(["重复", "重复"]), []);
assert.deepEqual(normalizeReplySuggestions(["", "有效"]), []);
assert.deepEqual(
  normalizeReplySuggestions(["一".repeat(64), "另一条"]),
  ["一".repeat(64), "另一条"],
);
assert.deepEqual(
  normalizeReplySuggestions(["一".repeat(65), "另一条"]),
  [],
);

const suggestionSource = fs.readFileSync(
  new URL("../src/chat-reply-suggestions.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  suggestionSource,
  /SUGGESTION_RULES|createReplySuggestions|抱抱小乖乖|好，我在认真听/,
  "reply choices must come from the current model turn, never fixed frontend copy",
);

console.log("chat reply suggestion tests passed");
