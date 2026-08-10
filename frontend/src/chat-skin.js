export const DEFAULT_CHAT_SKIN_PREFERENCES = Object.freeze({
  skin: "classic-glass",
  ornamentActivity: "natural",
  dynamicComposerHint: true,
  reduceMotion: false,
});

export const CHAT_SKIN_STORAGE_KEY = "dengta.chat-skin.v1";

const CHAT_SKINS = new Set(["classic-glass", "taotao-cream"]);
const ORNAMENT_ACTIVITY_LEVELS = new Set(["quiet", "natural", "lively"]);

export function normalizeChatSkinPreferences(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const ornamentActivity =
    source.ornamentActivity ?? source.ornament_activity;
  const dynamicComposerHint =
    source.dynamicComposerHint ?? source.dynamic_composer_hint;
  const reduceMotion = source.reduceMotion ?? source.reduce_motion;
  return {
    skin: CHAT_SKINS.has(source.skin)
      ? source.skin
      : DEFAULT_CHAT_SKIN_PREFERENCES.skin,
    ornamentActivity: ORNAMENT_ACTIVITY_LEVELS.has(ornamentActivity)
      ? ornamentActivity
      : DEFAULT_CHAT_SKIN_PREFERENCES.ornamentActivity,
    dynamicComposerHint:
      typeof dynamicComposerHint === "boolean"
        ? dynamicComposerHint
        : DEFAULT_CHAT_SKIN_PREFERENCES.dynamicComposerHint,
    reduceMotion:
      typeof reduceMotion === "boolean"
        ? reduceMotion
        : DEFAULT_CHAT_SKIN_PREFERENCES.reduceMotion,
  };
}

export function chatSkinPreferencesApiPayload(value) {
  const normalized = normalizeChatSkinPreferences(value);
  return {
    skin: normalized.skin,
    ornament_activity: normalized.ornamentActivity,
    dynamic_composer_hint: normalized.dynamicComposerHint,
    reduce_motion: normalized.reduceMotion,
  };
}

export function readStoredChatSkinPreferences(
  storage = globalThis.localStorage,
  accountScope = "",
) {
  try {
    const raw = readAccountStorage(
      storage,
      CHAT_SKIN_STORAGE_KEY,
      accountScope,
      { migrateLegacy: true },
    );
    return raw
      ? normalizeChatSkinPreferences(JSON.parse(raw))
      : DEFAULT_CHAT_SKIN_PREFERENCES;
  } catch {
    return DEFAULT_CHAT_SKIN_PREFERENCES;
  }
}

export function writeStoredChatSkinPreferences(
  value,
  storage = globalThis.localStorage,
  accountScope = "",
) {
  const normalized = normalizeChatSkinPreferences(value);
  try {
    writeAccountStorage(
      storage,
      CHAT_SKIN_STORAGE_KEY,
      accountScope,
      JSON.stringify(normalized),
    );
  } catch {
    // A restricted WebView can reject storage; in-memory state remains usable.
  }
  return normalized;
}

function hasMessageMedia(message) {
  const toolCalls = message?.tool_calls;
  return Boolean(
    toolCalls?.sticker_id ||
      toolCalls?.artwork_id ||
      (Array.isArray(message?.attachments) && message.attachments.length > 0) ||
      (Array.isArray(message?.files) && message.files.length > 0),
  );
}

export function getMessageSkinPresentation(
  messages,
  index,
  preferences = DEFAULT_CHAT_SKIN_PREFERENCES,
) {
  const list = Array.isArray(messages) ? messages : [];
  const message = list[index];
  if (!message) {
    return { groupStart: false, groupEnd: false, showOrnament: false };
  }

  const previous = list[index - 1];
  const next = list[index + 1];
  const groupStart = !previous || previous.role !== message.role;
  const groupEnd = !next || next.role !== message.role;
  const normalized = normalizeChatSkinPreferences(preferences);
  const hasText = typeof message.content === "string" && message.content.trim();

  return {
    groupStart,
    groupEnd,
    showOrnament:
      normalized.skin === "taotao-cream" &&
      normalized.ornamentActivity !== "quiet" &&
      groupStart &&
      Boolean(hasText) &&
      !hasMessageMedia(message),
  };
}
import { readAccountStorage, writeAccountStorage } from "./account-storage.js";
