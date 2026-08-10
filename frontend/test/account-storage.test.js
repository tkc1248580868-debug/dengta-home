import assert from "node:assert/strict";
import {
  DENGTA_THEME_STORAGE_KEY,
  readThemePreferences,
  writeThemePreferences,
} from "../src/dengta-theme.js";
import {
  CHAT_SKIN_STORAGE_KEY,
  readStoredChatSkinPreferences,
  writeStoredChatSkinPreferences,
} from "../src/chat-skin.js";
import {
  GROQ_EXPIRY_STORAGE_KEY,
  readGroqExpiryDate,
  storeGroqExpiryDate,
} from "../src/service-status.js";
import {
  AMBIENT_PREFERENCES_KEY,
  readAmbientPreferences,
  storeAmbientPreferences,
} from "../src/ambient-context.js";

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const accountA = "account-a";
const accountB = "account-b";
const storage = memoryStorage({
  [DENGTA_THEME_STORAGE_KEY]: JSON.stringify({
    preset: "fog-blue",
    cardOpacity: 0.73,
  }),
  [CHAT_SKIN_STORAGE_KEY]: JSON.stringify({
    skin: "taotao-cream",
    ornamentActivity: "lively",
  }),
  [GROQ_EXPIRY_STORAGE_KEY]: "2026-11-08",
  [AMBIENT_PREFERENCES_KEY]: JSON.stringify({
    enabled: true,
    minimized: true,
    side: "left",
  }),
});

assert.equal(readThemePreferences(storage, accountA).cardOpacity, 0.73);
assert.equal(storage.getItem(DENGTA_THEME_STORAGE_KEY), null);
assert.equal(readThemePreferences(storage, accountB).cardOpacity, 0.18);
writeThemePreferences({ preset: "moon-sand", cardOpacity: 0.24 }, storage, accountB);
assert.equal(readThemePreferences(storage, accountA).cardOpacity, 0.73);
assert.equal(readThemePreferences(storage, accountB).cardOpacity, 0.24);

assert.equal(readStoredChatSkinPreferences(storage, accountA).skin, "taotao-cream");
assert.equal(storage.getItem(CHAT_SKIN_STORAGE_KEY), null);
assert.equal(readStoredChatSkinPreferences(storage, accountB).skin, "classic-glass");
writeStoredChatSkinPreferences(
  { skin: "classic-glass", reduceMotion: true },
  storage,
  accountB,
);
assert.equal(readStoredChatSkinPreferences(storage, accountA).reduceMotion, false);
assert.equal(readStoredChatSkinPreferences(storage, accountB).reduceMotion, true);

assert.equal(readGroqExpiryDate(storage, accountA), "2026-11-08");
assert.equal(readGroqExpiryDate(storage, accountB), "");
storeGroqExpiryDate("2027-01-01", storage, accountB);
assert.equal(readGroqExpiryDate(storage, accountA), "2026-11-08");
assert.equal(readGroqExpiryDate(storage, accountB), "2027-01-01");

assert.equal(readAmbientPreferences(storage, accountA).preferences.side, "left");
assert.equal(readAmbientPreferences(storage, accountB).state, "missing");
storeAmbientPreferences(
  { enabled: true, minimized: false, side: "right" },
  storage,
  accountB,
);
assert.equal(readAmbientPreferences(storage, accountA).preferences.minimized, true);
assert.equal(readAmbientPreferences(storage, accountB).preferences.minimized, false);

console.log("account-scoped local preference tests passed");
