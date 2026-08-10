import { useEffect, useLayoutEffect, useRef, useState } from "react";

const PRELUDE_DURATION_MS = 3_180;
const THREAD_REST_MS = 940;
const THREAD_PULL_MS = 1_060;
const THREAD_POINT_COUNT = 180;
const THREAD_STAGGER = 0.7;
const TARGET_LINE = {
  startX: 18,
  endX: 402,
  y: 54,
};

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function easeThread(value) {
  const clamped = clamp01(value);
  return 1 - (1 - clamped) ** 3;
}

function pointsAttribute(points) {
  return points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
}

export default function DengTaPrelude() {
  const [visible, setVisible] = useState(true);
  const sourcePathRef = useRef(null);
  const threadRef = useRef(null);
  const tensionRef = useRef(null);
  const tipRef = useRef(null);

  useLayoutEffect(() => {
    const sourcePath = sourcePathRef.current;
    const thread = threadRef.current;
    const tension = tensionRef.current;
    const tip = tipRef.current;
    if (!sourcePath || !thread || !tension || !tip) return undefined;

    const totalLength = sourcePath.getTotalLength?.();
    if (!Number.isFinite(totalLength) || totalLength <= 0) return undefined;

    const sourcePoints = Array.from(
      { length: THREAD_POINT_COUNT },
      (_, index) => {
        const ratio = index / (THREAD_POINT_COUNT - 1);
        const point = sourcePath.getPointAtLength(totalLength * ratio);
        return { x: point.x, y: point.y };
      },
    );
    const targetPoints = sourcePoints.map((_, index) => {
      const ratio = index / (THREAD_POINT_COUNT - 1);
      return {
        x:
          TARGET_LINE.startX +
          (TARGET_LINE.endX - TARGET_LINE.startX) * ratio,
        y: TARGET_LINE.y,
      };
    });

    thread.setAttribute("points", pointsAttribute(sourcePoints));
    const initialTip = sourcePoints.at(-1);
    tip.setAttribute("cx", initialTip.x);
    tip.setAttribute("cy", initialTip.y);
    tension.setAttribute("cx", sourcePoints[0].x);
    tension.setAttribute("cy", sourcePoints[0].y);

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
      thread.setAttribute("points", pointsAttribute(targetPoints));
      tip.setAttribute("cx", TARGET_LINE.endX);
      tip.setAttribute("cy", TARGET_LINE.y);
      tension.setAttribute("cx", TARGET_LINE.endX);
      tension.setAttribute("cy", TARGET_LINE.y);
      return undefined;
    }

    let frameId = 0;
    let startTime = 0;
    const pullWindow = 1 - THREAD_STAGGER;

    function renderFrame(timestamp) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const pullProgress = clamp01(
        (elapsed - THREAD_REST_MS) / THREAD_PULL_MS,
      );
      let tensionIndex = 0;

      const nextPoints = sourcePoints.map((sourcePoint, index) => {
        const pointRatio = index / (THREAD_POINT_COUNT - 1);
        const pointProgress = easeThread(
          (pullProgress - pointRatio * THREAD_STAGGER) / pullWindow,
        );
        if (pointProgress > 0.04) tensionIndex = index;
        const targetPoint = targetPoints[index];
        return {
          x: sourcePoint.x + (targetPoint.x - sourcePoint.x) * pointProgress,
          y: sourcePoint.y + (targetPoint.y - sourcePoint.y) * pointProgress,
        };
      });

      thread.setAttribute("points", pointsAttribute(nextPoints));
      const pullFront =
        nextPoints[Math.min(tensionIndex + 1, nextPoints.length - 1)];
      const currentTip = nextPoints.at(-1);
      tension.setAttribute("cx", pullFront.x);
      tension.setAttribute("cy", pullFront.y);
      tip.setAttribute("cx", currentTip.x);
      tip.setAttribute("cy", currentTip.y);

      if (elapsed < THREAD_REST_MS + THREAD_PULL_MS + 80) {
        frameId = window.requestAnimationFrame(renderFrame);
      } else {
        thread.setAttribute("points", pointsAttribute(targetPoints));
        tension.setAttribute("cx", TARGET_LINE.endX);
        tension.setAttribute("cy", TARGET_LINE.y);
        tip.setAttribute("cx", TARGET_LINE.endX);
        tip.setAttribute("cy", TARGET_LINE.y);
      }
    }

    frameId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), PRELUDE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="dengta-prelude" aria-hidden="true">
      <div className="dengta-prelude-mark">
        <svg viewBox="0 0 420 108" role="presentation">
          <path
            ref={sourcePathRef}
            className="dengta-prelude-source"
            data-word="DENGTA"
            d="M18 72C27 72 34 63 39 52C45 38 47 22 43 16C37 8 29 14 30 29C32 49 50 68 68 65C86 62 90 38 78 25C66 12 48 17 43 34C38 51 50 65 68 65C82 66 97 59 98 51C99 43 88 42 82 49C73 59 82 70 97 67C106 66 111 61 115 56C119 50 119 43 117 39C120 50 121 60 120 66C126 54 133 43 143 43C153 43 151 55 151 62C151 69 157 71 165 64C172 56 179 46 188 47C198 48 199 58 193 65C187 72 175 70 173 61C171 51 183 43 198 47C198 61 200 77 194 88C188 99 172 101 168 91C165 83 176 78 188 83C204 86 214 70 220 60C228 45 233 26 232 18C234 35 235 50 235 64C236 71 243 73 250 68C257 63 259 55 260 48C249 48 241 49 233 51C245 49 258 48 270 48C278 48 282 57 279 65C275 73 263 73 259 64C255 54 266 46 279 48C279 59 279 69 285 70C293 71 300 63 304 53C312 45 324 44 330 52C337 62 331 75 320 74C307 73 307 56 318 50C329 44 339 53 340 65C341 73 348 74 356 66C365 58 378 55 402 57"
          />
          <polyline
            ref={threadRef}
            className="dengta-prelude-thread"
            data-motion="progressive-tension"
          />
          <circle
            ref={tensionRef}
            className="dengta-prelude-tension"
            r="2.2"
          />
          <circle ref={tipRef} className="dengta-prelude-tip" r="2.35" />
        </svg>
        <div className="dengta-prelude-copy">
          <strong>DENGTA</strong>
        </div>
      </div>
    </div>
  );
}
