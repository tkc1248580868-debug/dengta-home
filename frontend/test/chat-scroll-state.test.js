import assert from "node:assert/strict";
import fs from "node:fs";
import {
  captureChatScrollState,
  claimPendingChatScrollRestore,
  restoreChatScrollState,
} from "../src/chat-scroll-state.js";

const pinnedList = {
  clientHeight: 320,
  scrollHeight: 1_280,
  scrollTop: 960,
};
assert.deepEqual(captureChatScrollState(pinnedList), {
  distanceFromBottom: 0,
  pinnedToBottom: true,
  scrollTop: 960,
});

const remountedPinnedList = {
  clientHeight: 320,
  scrollHeight: 1_640,
  scrollTop: 0,
};
restoreChatScrollState(remountedPinnedList, captureChatScrollState(pinnedList));
assert.equal(
  remountedPinnedList.scrollTop,
  1_640,
  "a chat left at the bottom must return to the new bottom after remount",
);

const readingList = {
  clientHeight: 320,
  scrollHeight: 1_280,
  scrollTop: 410,
};
const readingSnapshot = captureChatScrollState(readingList);
assert.equal(readingSnapshot.pinnedToBottom, false);

const remountedReadingList = {
  clientHeight: 320,
  scrollHeight: 1_480,
  scrollTop: 0,
};
restoreChatScrollState(remountedReadingList, readingSnapshot);
assert.equal(
  remountedReadingList.scrollTop,
  410,
  "a chat left while reading older messages must preserve its position",
);

const pendingRef = {
  current: {
    sessionId: "session-a",
    snapshot: readingSnapshot,
    waitForMessages: false,
  },
};
const claimedRestore = claimPendingChatScrollRestore(
  pendingRef,
  "session-a",
  true,
);
assert.equal(claimedRestore?.sessionId, "session-a");
assert.equal(
  pendingRef.current,
  null,
  "a pending restoration must be claimed before streaming updates can keep it stale",
);
assert.equal(
  claimPendingChatScrollRestore(pendingRef, "session-a", true),
  null,
  "finishing a stream must not replay the old pre-stream scroll position",
);

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
assert.match(
  app,
  /pendingChatScrollRestoreRef/,
  "App must retain a pending scroll snapshot while the chat list is unmounted",
);
assert.match(
  app,
  /captureChatScrollState\([\s\S]*?messageListRef\.current/,
  "leaving chat must capture the live message list position",
);
assert.match(
  app,
  /requestAnimationFrame\([\s\S]*?requestAnimationFrame\([\s\S]*?restoreChatScrollState/,
  "chat restoration must survive the first post-mount layout frame",
);
assert.doesNotMatch(
  app,
  /view === "chat" && activeView !== "chat"\) \{\s*shouldAutoScrollRef\.current = true;/,
  "returning to chat must not discard the user's saved scroll state",
);

console.log("chat scroll restoration tests passed");
