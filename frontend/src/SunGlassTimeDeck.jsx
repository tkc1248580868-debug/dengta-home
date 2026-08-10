import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  LocateFixed,
  MoonStar,
  SlidersHorizontal,
  Sparkles,
  Sun,
  SunMedium,
} from "lucide-react";
import { weatherModeFromAmbient } from "./sun-glass-sky";
import { useGlassScrubber } from "./use-glass-scrubber";

const TIME_PRESETS = [
  { minute: 480, label: "清晨 08:00", Icon: SunMedium },
  { minute: 1080, label: "红霞 18:00", Icon: Sparkles },
  { minute: 1120, label: "蓝调 18:40", Icon: MoonStar },
  { minute: 1320, label: "银河 22:00", Icon: MoonStar },
];

const WEATHER_PRESETS = [
  { id: "cloudy", label: "微云", Icon: CloudSun },
  { id: "rain", label: "雨幕", Icon: CloudRain },
  { id: "storm", label: "晴雷", Icon: CloudLightning },
  { id: "clear", label: "晴空", Icon: Sun },
];

const SCRUB_COMMIT_INTERVAL_MS = 84;

function formatMinute(value) {
  const minute = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60,
  ).padStart(2, "0")}`;
}

export default function SunGlassTimeDeck({
  snapshot,
  previewMinute,
  onPreviewMinute,
  onNow,
  weather,
  weatherMode,
  onWeatherMode,
  glassLevel,
  onGlassLevel,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const rootRef = useRef(null);
  const frameRef = useRef(0);
  const commitTimerRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const pendingMinuteRef = useRef(null);
  const externalMinute = Number.isFinite(previewMinute)
    ? previewMinute
    : snapshot.minute;
  const [scrubMinute, setScrubMinute] = useState(null);
  const displayedMinute = Number.isFinite(scrubMinute)
    ? scrubMinute
    : externalMinute;
  const liveWeatherMode = weatherModeFromAmbient(weather) || "clear";
  const usesLiveWeather = !weatherMode;
  const displayedWeather = weatherMode || liveWeatherMode;
  const displayedWeatherLabel =
    WEATHER_PRESETS.find((preset) => preset.id === displayedWeather)?.label ||
    "晴空";
  const glassScrubber = useGlassScrubber(glassLevel, onGlassLevel);

  useEffect(() => {
    if (!isOpen) return undefined;

    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    }

    function closeFromEscape(event) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [isOpen]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      delete document.documentElement.dataset.timeScrubbing;
    },
    [],
  );

  function flushPendingMinute() {
    commitTimerRef.current = 0;
    const pendingMinute = pendingMinuteRef.current;
    pendingMinuteRef.current = null;
    if (pendingMinute === null) return;
    lastCommitAtRef.current = performance.now();
    onPreviewMinute?.(pendingMinute);
  }

  function startScrubbing() {
    document.documentElement.dataset.timeScrubbing = "true";
    setIsScrubbing(true);
  }

  function scheduleMinute(value) {
    const nextMinute = Math.max(0, Math.min(1439, Number(value) || 0));
    setScrubMinute(nextMinute);
    pendingMinuteRef.current = nextMinute;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const elapsed = performance.now() - lastCommitAtRef.current;
      const wait = Math.max(0, SCRUB_COMMIT_INTERVAL_MS - elapsed);
      if (wait === 0) flushPendingMinute();
      else if (!commitTimerRef.current) {
        commitTimerRef.current = window.setTimeout(flushPendingMinute, wait);
      }
    });
  }

  function finishScrubbing() {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = 0;
    }
    const pendingMinute = pendingMinuteRef.current;
    pendingMinuteRef.current = null;
    if (pendingMinute !== null) onPreviewMinute?.(pendingMinute);
    delete document.documentElement.dataset.timeScrubbing;
    setIsScrubbing(false);
    setScrubMinute(null);
  }

  function selectMinute(value) {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    frameRef.current = 0;
    commitTimerRef.current = 0;
    pendingMinuteRef.current = null;
    setScrubMinute(null);
    onPreviewMinute?.(value);
  }

  return (
    <section
      ref={rootRef}
      className="sun-glass-time-deck sun-glass-panel"
      aria-label="时间光线控制器"
      data-time-scrubbing={isScrubbing ? "true" : "false"}
    >
      <div className="sun-glass-time-deck-top">
        <button
          type="button"
          className="sun-glass-button compact"
          onClick={() => {
            onNow?.();
            setScrubMinute(null);
            setIsOpen(false);
          }}
        >
          <Clock3 aria-hidden="true" />
          <span>现在</span>
        </button>
        <strong>{formatMinute(displayedMinute)}</strong>
        <button
          type="button"
          className="sun-glass-button compact"
          aria-label="天气与光线设置"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((current) => !current)}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span>
            {usesLiveWeather ? `实时${displayedWeatherLabel}` : displayedWeatherLabel}
            {" · 光线"}
          </span>
        </button>
      </div>

      <div className="sun-glass-time-scale" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <input
        className="sun-glass-time-slider"
        type="range"
        min="0"
        max="1439"
        step="1"
        value={Math.round(displayedMinute)}
        aria-label="一天中的时间"
        onPointerDown={startScrubbing}
        onPointerUp={finishScrubbing}
        onPointerCancel={finishScrubbing}
        onBlur={finishScrubbing}
        onChange={(event) => scheduleMinute(event.target.value)}
      />

      <div
        className={`sun-glass-jelly-popover sun-glass-time-menu${
          isOpen ? " is-open" : ""
        }`}
      >
        <div className="sun-glass-time-presets">
          {TIME_PRESETS.map(({ minute, label, Icon }) => (
            <button
              type="button"
              key={minute}
              onClick={() => selectMinute(minute)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="sun-glass-weather-options" aria-label="天气预览">
          <button
            type="button"
            className={usesLiveWeather ? "is-active" : ""}
            aria-pressed={usesLiveWeather}
            aria-label="跟随实时天气"
            onClick={() => onWeatherMode?.(null)}
          >
            <LocateFixed aria-hidden="true" />
            <span>实时</span>
          </button>
          {WEATHER_PRESETS.map(({ id, label, Icon }) => (
            <button
              type="button"
              key={id}
              className={displayedWeather === id ? "is-active" : ""}
              aria-pressed={displayedWeather === id}
              aria-label={label}
              onClick={() => onWeatherMode?.(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <label className="sun-glass-tuner">
          <span>
            <Droplets aria-hidden="true" />
            <span>玻璃度</span>
            <output>{Math.round(glassScrubber.value)}</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(glassScrubber.value)}
            aria-label="全局玻璃度"
            {...glassScrubber.inputProps}
          />
        </label>
      </div>
    </section>
  );
}
