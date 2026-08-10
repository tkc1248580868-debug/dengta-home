import { HOT_ZONES, RECOVERY_ACTIONS } from "./companion-status.js";

export const COMPANION_INTERACTION_TYPES = [
  ...HOT_ZONES,
  ...RECOVERY_ACTIONS,
].map((item) => item.id);

export function emptyCompanionInteractionCounts() {
  return Object.fromEntries(
    COMPANION_INTERACTION_TYPES.map((type) => [type, 0]),
  );
}

export function enqueueCompanionInteraction({
  queue,
  zoneId,
  stats,
  sessionId,
  preInteractionStatus,
  now,
  eventId,
  debounceMs = 1100,
  maxBatchSize = 100,
}) {
  const currentQueue = Array.isArray(queue) ? queue : [];
  if (!COMPANION_INTERACTION_TYPES.includes(zoneId)) {
    return currentQueue;
  }

  const interactionCounts = Object.fromEntries(
    COMPANION_INTERACTION_TYPES.map((type) => [
      type,
      Math.max(0, Math.round(Number(stats?.counts?.[type]) || 0)),
    ]),
  );
  const pending = currentQueue.at(-1);
  const canMerge =
    pending &&
    pending.sessionId === sessionId &&
    pending.burstCount < maxBatchSize &&
    now - pending.lastClickedAt <= debounceMs * 2;

  if (canMerge) {
    const batchCounts = {
      ...pending.batchCounts,
      [zoneId]: pending.batchCounts[zoneId] + 1,
    };
    const merged = {
      ...pending,
      interactionType: zoneId,
      burstCount: pending.burstCount + 1,
      interactionCounts,
      batchCounts,
      interactionCount: interactionCounts[zoneId],
      streakCount: stats.streakCount,
      recentSequence: Array.isArray(stats?.recentSequence)
        ? stats.recentSequence.slice(-12)
        : [...pending.recentSequence, zoneId].slice(-12),
      lastClickedAt: now,
    };
    return [...currentQueue.slice(0, -1), merged];
  }

  const batchCounts = emptyCompanionInteractionCounts();
  batchCounts[zoneId] = 1;
  return [
    ...currentQueue,
    {
      eventId,
      sessionId,
      preInteractionStatus:
        preInteractionStatus && typeof preInteractionStatus === "object"
          ? preInteractionStatus
          : null,
      interactionType: zoneId,
      burstCount: 1,
      interactionCounts,
      batchCounts,
      interactionCount: interactionCounts[zoneId],
      streakCount: stats.streakCount,
      recentSequence: Array.isArray(stats?.recentSequence)
        ? stats.recentSequence.slice(-12)
        : [zoneId],
      lastClickedAt: now,
    },
  ];
}
