export const DEFAULT_PROFILE_INTRODUCTION =
  "人家现在有点害羞，还不想把自己全部摊开给你看呢。";

export const PROFILE_STABLE_FIELDS = [
  { key: "personality_traits", label: "性格" },
  { key: "likes", label: "喜欢" },
  { key: "dislikes", label: "不喜欢" },
  { key: "habits", label: "小习惯" },
  { key: "communication_style", label: "相处方式" },
];

export const PROFILE_IDENTITY_FIELDS = [
  { key: "gender_identity", label: "性别认同" },
  { key: "pronouns", label: "希望你怎样称呼我" },
  { key: "relationship_position", label: "我们的关系" },
];

function cleanText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanList(value) {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item)).filter(Boolean)
    : [];
}

export function normalizeCompanionProfile(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const stable =
    source.stable && typeof source.stable === "object" ? source.stable : {};
  const identity =
    source.identity && typeof source.identity === "object"
      ? source.identity
      : {};
  const mood =
    source.current_mood && typeof source.current_mood === "object"
      ? source.current_mood
      : null;

  return {
    introduction: cleanText(
      source.introduction,
      DEFAULT_PROFILE_INTRODUCTION,
    ),
    stable: Object.fromEntries(
      PROFILE_STABLE_FIELDS.map(({ key }) => [key, cleanList(stable[key])]),
    ),
    identity: Object.fromEntries(
      PROFILE_IDENTITY_FIELDS.map(({ key }) => [
        key,
        cleanText(identity[key]),
      ]),
    ),
    pending_identity_changes: Array.isArray(source.pending_identity_changes)
      ? source.pending_identity_changes
          .map((proposal) => ({
            id: cleanText(proposal?.id),
            field: cleanText(proposal?.field),
            proposed_value: cleanText(proposal?.proposed_value),
            proposed_at: cleanText(proposal?.proposed_at),
            evidence_message_ids: cleanList(
              proposal?.evidence_message_ids,
            ),
          }))
          .filter(
            (proposal) =>
              proposal.id &&
              PROFILE_IDENTITY_FIELDS.some(
                ({ key }) => key === proposal.field,
              ) &&
              proposal.proposed_value,
          )
      : [],
    current_mood:
      mood && cleanText(mood.label)
        ? {
            label: cleanText(mood.label),
            note: cleanText(mood.note),
            observed_at: cleanText(mood.observed_at),
            expires_at: cleanText(mood.expires_at),
          }
        : null,
  };
}

export function normalizeProfilePayload(value = {}) {
  const versions = Array.isArray(value.versions)
    ? value.versions
        .map((entry) => ({
          id: cleanText(entry?.id),
          version: Number(entry?.version) || 0,
          profile: normalizeCompanionProfile(entry?.profile),
          evidence: Array.isArray(entry?.evidence) ? entry.evidence : [],
          change_reason: cleanText(entry?.change_reason),
          confirmed_identity_change:
            entry?.confirmed_identity_change === true,
          created_at: cleanText(entry?.created_at),
        }))
        .filter((entry) => entry.version > 0)
    : [];

  return {
    profile: normalizeCompanionProfile(value.profile),
    latest_version: Number(value.latest_version) || null,
    versions,
  };
}

export function hasLearnedProfileDetails(profile) {
  const normalized = normalizeCompanionProfile(profile);
  return (
    PROFILE_STABLE_FIELDS.some(
      ({ key }) => normalized.stable[key].length > 0,
    ) ||
    PROFILE_IDENTITY_FIELDS.some(
      ({ key }) => Boolean(normalized.identity[key]),
    ) ||
    Boolean(normalized.current_mood)
  );
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function describeProfileChanges(currentValue, previousValue) {
  const current = normalizeCompanionProfile(currentValue);
  const previous = normalizeCompanionProfile(previousValue);
  const changes = [];

  if (current.introduction !== previous.introduction) {
    changes.push("自我介绍");
  }
  for (const field of PROFILE_STABLE_FIELDS) {
    if (!sameValue(current.stable[field.key], previous.stable[field.key])) {
      changes.push(field.label);
    }
  }
  for (const field of PROFILE_IDENTITY_FIELDS) {
    if (!sameValue(current.identity[field.key], previous.identity[field.key])) {
      changes.push(field.label);
    }
  }
  if (!sameValue(current.current_mood, previous.current_mood)) {
    changes.push("此刻心情");
  }
  if (
    !sameValue(
      current.pending_identity_changes,
      previous.pending_identity_changes,
    )
  ) {
    changes.push("待确认身份");
  }

  return changes;
}

export function createProfileActionId(randomUUID = globalThis.crypto?.randomUUID) {
  if (typeof randomUUID === "function") {
    return randomUUID.call(globalThis.crypto);
  }
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
