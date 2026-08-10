const MAX_SUGGESTION_CHARACTERS = 64;

function replaceControlCharacters(value) {
  return Array.from(String(value || ""), (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
}

function cleanSuggestion(value) {
  return Array.from(
    replaceControlCharacters(value)
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, MAX_SUGGESTION_CHARACTERS + 1)
    .join("");
}

export function normalizeReplySuggestions(value) {
  if (!Array.isArray(value) || value.length !== 2) return [];

  const suggestions = value.map(cleanSuggestion);
  if (
    suggestions.some(
      (item) =>
        !item || Array.from(item).length > MAX_SUGGESTION_CHARACTERS,
    )
  ) {
    return [];
  }

  const unique = new Set(suggestions.map((item) => item.toLocaleLowerCase()));
  return unique.size === 2 ? suggestions : [];
}

export function readReplySuggestions(message = {}) {
  return normalizeReplySuggestions(message?.tool_calls?.reply_suggestions);
}
