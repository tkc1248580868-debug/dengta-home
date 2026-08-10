export const INNER_MONOLOGUE_STORAGE_KEY =
  "dengta_visible_inner_monologues_v1";

function storageKey(accountScope = "") {
  const scope = String(accountScope || "").trim();
  return scope
    ? `${INNER_MONOLOGUE_STORAGE_KEY}:${scope}`
    : INNER_MONOLOGUE_STORAGE_KEY;
}

const MAX_RECORDS = 120;
const MAX_TEXT_LENGTH = 12_000;

function cleanText(value, maximum = MAX_TEXT_LENGTH) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || [9, 10, 13].includes(code);
    })
    .join("")
    .trim()
    .slice(0, maximum);
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = cleanText(value.text);
  if (!text) return null;
  const createdAt = Number.isFinite(Date.parse(value.createdAt))
    ? new Date(value.createdAt).toISOString()
    : new Date().toISOString();
  return { text, createdAt };
}

export function readInnerMonologues(
  storage = globalThis.localStorage,
  accountScope = "",
) {
  if (!storage) return {};
  try {
    const source = JSON.parse(
      storage.getItem(storageKey(accountScope)) || "{}",
    );
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(source)
        .map(([messageId, value]) => [
          cleanText(messageId, 80),
          normalizeRecord(value),
        ])
        .filter(([messageId, value]) => messageId && value)
        .slice(-MAX_RECORDS),
    );
  } catch {
    return {};
  }
}

export function storeInnerMonologue(
  { messageId, text, createdAt = new Date().toISOString() },
  storage = globalThis.localStorage,
  accountScope = "",
) {
  const id = cleanText(messageId, 80);
  const record = normalizeRecord({ text, createdAt });
  if (!storage || !id || !record) {
    return readInnerMonologues(storage, accountScope);
  }
  const current = readInnerMonologues(storage, accountScope);
  const next = Object.fromEntries(
    [...Object.entries(current), [id, record]].slice(-MAX_RECORDS),
  );
  try {
    storage.setItem(storageKey(accountScope), JSON.stringify(next));
  } catch {
    // The generated text remains visible for this app session.
  }
  return next;
}

export function innerMonologueForMessage(records, messageId) {
  const value = records?.[String(messageId || "")];
  return normalizeRecord(value);
}
