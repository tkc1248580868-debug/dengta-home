import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INNER_MONOLOGUE_STORAGE_KEY,
  innerMonologueForMessage,
  readInnerMonologues,
  storeInnerMonologue,
} from "../src/inner-monologue.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

const storage = createStorage();
const saved = storeInnerMonologue(
  {
    messageId: "assistant-1",
    text: `\u0000${"我想安静地把这个念头写下来。".repeat(80)}`,
    createdAt: "2026-08-02T10:00:00.000Z",
  },
  storage,
);

assert.equal(saved["assistant-1"].text.includes("\u0000"), false);
assert.equal(saved["assistant-1"].text.length > 800, true);
assert.equal(
  innerMonologueForMessage(readInnerMonologues(storage), "assistant-1").text,
  saved["assistant-1"].text,
);
assert.ok(storage.getItem(INNER_MONOLOGUE_STORAGE_KEY));

storeInnerMonologue(
  { messageId: "assistant-a", text: "账号甲的心声" },
  storage,
  "account-a",
);
storeInnerMonologue(
  { messageId: "assistant-b", text: "账号乙的心声" },
  storage,
  "account-b",
);
assert.equal(
  readInnerMonologues(storage, "account-a")["assistant-a"].text,
  "账号甲的心声",
);
assert.equal(
  readInnerMonologues(storage, "account-a")["assistant-b"],
  undefined,
);
assert.equal(
  readInnerMonologues(storage, "account-b")["assistant-b"].text,
  "账号乙的心声",
);

const malformedStorage = createStorage({
  [INNER_MONOLOGUE_STORAGE_KEY]: "not-json",
});
assert.deepEqual(readInnerMonologues(malformedStorage), {});

const messageExtrasSource = readFileSync(
  new URL("../src/ChatMessageExtras.jsx", import.meta.url),
  "utf8",
);
const appStylesSource = readFileSync(
  new URL("../src/index.css", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);
assert.match(messageExtrasSource, /setMonologueDialogOpen\(true\)/);
assert.match(messageExtrasSource, /className="inner-monologue-dialog-backdrop"/);
assert.match(messageExtrasSource, /role="dialog"/);
assert.match(messageExtrasSource, /aria-modal="true"/);
assert.match(appStylesSource, /\.inner-monologue-dialog-backdrop\s*\{/);
assert.match(appStylesSource, /\.inner-monologue-dialog\s*\{/);
assert.match(appSource, /\/companion\/inner-monologue/);
assert.match(appSource, /timeoutMs:\s*300\s*\*\s*1000/);

console.log("inner monologue local-cache checks passed");
