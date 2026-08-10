import { useEffect, useRef, useState } from "react";
import { applyGlassLevel } from "./dengta-theme";

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

export function useGlassScrubber(value, onCommit) {
  const [previewValue, setPreviewValue] = useState(null);
  const frameRef = useRef(0);
  const pendingRef = useRef(null);
  const scrubbingRef = useRef(false);
  const commitRef = useRef(onCommit);

  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);

  const externalValue = clampPercent(value);
  const displayedValue = previewValue ?? externalValue;

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      delete document.documentElement.dataset.glassScrubbing;
    },
    []
  );

  function applyPendingPreview() {
    frameRef.current = 0;
    if (pendingRef.current === null) return;
    applyGlassLevel(pendingRef.current / 100, document.documentElement, {
      includeBlur: false,
    });
  }

  function start() {
    scrubbingRef.current = true;
    document.documentElement.dataset.glassScrubbing = "true";
  }

  function change(nextValue) {
    const next = clampPercent(nextValue);
    if (!scrubbingRef.current) start();
    setPreviewValue(next);
    pendingRef.current = next;
    if (!frameRef.current) {
      frameRef.current = requestAnimationFrame(applyPendingPreview);
    }
  }

  function finish() {
    if (!scrubbingRef.current) return;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    const next = clampPercent(pendingRef.current ?? displayedValue);
    pendingRef.current = null;
    scrubbingRef.current = false;
    applyGlassLevel(next / 100, document.documentElement, {
      includeBlur: true,
    });
    delete document.documentElement.dataset.glassScrubbing;
    setPreviewValue(null);
    commitRef.current?.(next);
  }

  return {
    value: displayedValue,
    inputProps: {
      onPointerDown: start,
      onPointerUp: finish,
      onPointerCancel: finish,
      onBlur: finish,
      onKeyUp: finish,
      onChange: (event) => change(event.target.value),
    },
  };
}
