function updateMomentLiked(entries, momentId, liked) {
  if (!Array.isArray(entries)) return [];
  const normalizedId = String(momentId ?? "");
  return entries.map((entry) =>
    String(entry?.id ?? "") === normalizedId
      ? { ...entry, user_liked: liked === true }
      : entry,
  );
}

export async function toggleMomentLikeOptimistically({
  moment,
  updateMoments,
  persist,
  refresh,
}) {
  const previousLiked = moment?.user_liked === true;
  const nextLiked = !previousLiked;

  updateMoments((current) =>
    updateMomentLiked(current, moment?.id, nextLiked),
  );

  try {
    await persist(nextLiked);
  } catch (error) {
    updateMoments((current) =>
      updateMomentLiked(current, moment?.id, previousLiked),
    );
    throw error;
  }

  await refresh?.();
  return nextLiked;
}
