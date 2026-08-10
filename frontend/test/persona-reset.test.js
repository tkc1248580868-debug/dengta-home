import assert from "node:assert/strict";
import {
  PERSONA_LOCAL_STORAGE_KEYS,
  PERSONA_RESET_MARKER_KEY,
  applyPersonaResetToLocalStorage,
} from "../src/persona-reset.js";

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
    values,
  };
}

const storage = memoryStorage({
  dengta_home_auth_v1: "keep-auth",
  "dengta.ui-theme.v1": "keep-theme",
  dengta_companion_status_v1: "old-status",
  dengta_companion_interactions_v1: "old-interactions",
  dengta_intimate_duel_v2: "old-duel",
  dengta_message_references_v1: "old-references",
  dengta_prompt_receipt_v1: "old-receipt",
});

assert.equal(
  applyPersonaResetToLocalStorage("2026-08-02T08:00:00.000Z", storage),
  true,
);
for (const key of PERSONA_LOCAL_STORAGE_KEYS) {
  assert.equal(storage.getItem(key), null);
}
assert.equal(storage.getItem("dengta_home_auth_v1"), "keep-auth");
assert.equal(storage.getItem("dengta.ui-theme.v1"), "keep-theme");
assert.equal(
  storage.getItem(PERSONA_RESET_MARKER_KEY),
  "2026-08-02T08:00:00.000Z",
);
assert.equal(
  applyPersonaResetToLocalStorage("2026-08-02T08:00:00.000Z", storage),
  false,
);

const scopedStorage = memoryStorage({
  "dengta_companion_status_v1:account-a": "status-a",
  "dengta_companion_status_v1:account-b": "status-b",
  "dengta_prompt_receipt_v1:account-a": "receipt-a",
  "dengta_prompt_receipt_v1:account-b": "receipt-b",
});
assert.equal(
  applyPersonaResetToLocalStorage(
    "2026-08-03T09:00:00.000Z",
    scopedStorage,
    "account-a",
  ),
  true,
);
assert.equal(scopedStorage.getItem("dengta_companion_status_v1:account-a"), null);
assert.equal(scopedStorage.getItem("dengta_prompt_receipt_v1:account-a"), null);
assert.equal(
  scopedStorage.getItem("dengta_companion_status_v1:account-b"),
  "status-b",
);
assert.equal(
  scopedStorage.getItem("dengta_prompt_receipt_v1:account-b"),
  "receipt-b",
);

console.log("persona reset local cache tests passed");
