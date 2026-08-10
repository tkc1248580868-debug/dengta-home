function editableElementIsFocused(documentObject) {
  const activeElement = documentObject.activeElement;
  return Boolean(
    activeElement &&
      typeof activeElement.matches === "function" &&
      (activeElement.matches("input, textarea, select") ||
        activeElement.isContentEditable),
  );
}

export function installInnerHeightViewportFallback({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
} = {}) {
  const root = documentObject.documentElement;
  let fullHeight = windowObject.innerHeight;
  let viewportWidth = windowObject.innerWidth;
  let keyboardOpen = false;

  function fitViewport() {
    const nextHeight = windowObject.innerHeight;
    const nextViewportWidth = windowObject.innerWidth;
    if (Math.abs(nextViewportWidth - viewportWidth) > 48) {
      viewportWidth = nextViewportWidth;
      fullHeight = nextHeight;
    }

    const rawGap = Math.max(0, fullHeight - nextHeight);
    keyboardOpen =
      rawGap > 100 &&
      (keyboardOpen || editableElementIsFocused(documentObject));

    if (!keyboardOpen && rawGap <= 100) {
      fullHeight = Math.max(fullHeight, nextHeight);
    }

    root.dataset.keyboardOpen = keyboardOpen ? "true" : "false";
    root.style.setProperty(
      "--app-height",
      `${Math.round(keyboardOpen ? nextHeight : fullHeight)}px`,
    );
    if (!keyboardOpen && windowObject.scrollY) {
      windowObject.scrollTo(0, 0);
    }
  }

  fitViewport();
  windowObject.addEventListener("resize", fitViewport);
  windowObject.addEventListener("orientationchange", fitViewport);
  documentObject.addEventListener("focusin", fitViewport);
  documentObject.addEventListener("focusout", fitViewport);

  return () => {
    windowObject.removeEventListener("resize", fitViewport);
    windowObject.removeEventListener("orientationchange", fitViewport);
    documentObject.removeEventListener("focusin", fitViewport);
    documentObject.removeEventListener("focusout", fitViewport);
    delete root.dataset.keyboardOpen;
  };
}
