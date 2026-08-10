export function pendingAutosaveAfterFailure(failedSave, pendingSave) {
  return pendingSave || failedSave || null;
}

export function shouldFlushSettingsForLifecycle(
  eventType,
  visibilityState = "visible",
) {
  return (
    eventType === "pagehide" ||
    eventType === "online" ||
    (eventType === "visibilitychange" && visibilityState === "hidden")
  );
}

export function shouldScheduleSettingsOnViewChange({
  activeView,
  nextView,
  hasLoadedSettings,
}) {
  return (
    hasLoadedSettings === true &&
    activeView === "settings" &&
    nextView !== "settings"
  );
}
