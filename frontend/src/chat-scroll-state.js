const DEFAULT_BOTTOM_THRESHOLD = 140;

function finiteNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function captureChatScrollState(
  messageList,
  bottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
) {
  if (!messageList) return null;

  const scrollTop = finiteNonNegative(messageList.scrollTop);
  const distanceFromBottom = Math.max(
    0,
    finiteNonNegative(messageList.scrollHeight) -
      scrollTop -
      finiteNonNegative(messageList.clientHeight),
  );

  return {
    distanceFromBottom,
    pinnedToBottom:
      distanceFromBottom <= finiteNonNegative(bottomThreshold),
    scrollTop,
  };
}

export function restoreChatScrollState(messageList, snapshot) {
  if (!messageList || !snapshot) return false;

  messageList.scrollTop = snapshot.pinnedToBottom
    ? finiteNonNegative(messageList.scrollHeight)
    : finiteNonNegative(snapshot.scrollTop);
  return true;
}

export function claimPendingChatScrollRestore(
  pendingRef,
  sessionId,
  messagesReady,
) {
  const pending = pendingRef?.current;
  if (
    !pending ||
    pending.sessionId !== sessionId ||
    (pending.waitForMessages && !messagesReady)
  ) {
    return null;
  }

  pendingRef.current = null;
  return pending;
}
