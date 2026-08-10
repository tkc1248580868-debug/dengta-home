import { hydrateStoredThinkingTrace } from "./chat-thinking.js";
import { hydrateStoredVoiceAnalysis } from "./voice.js";
import { sanitizeStoredChatMessage } from "./chat-errors.js";

export function hydrateChatMessage(message = {}) {
  return sanitizeStoredChatMessage(
    hydrateStoredThinkingTrace(hydrateStoredVoiceAnalysis(message)),
  );
}

export function hydrateChatHistory(messages = []) {
  return Array.isArray(messages)
    ? messages.map((message) => hydrateChatMessage(message))
    : [];
}
