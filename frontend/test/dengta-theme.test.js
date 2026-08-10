import assert from "node:assert/strict";
import test from "node:test";
import {
  applyThemePreferences,
  DEFAULT_THEME_PREFERENCES,
  getCelestialSnapshot,
  normalizeThemePreferences,
} from "../src/dengta-theme.js";
import fs from "node:fs";
import {
  formatSolarTime,
  getSolarSchedule,
} from "../src/solar-cycle.js";
import {
  getSunGlassSky,
  weatherModeFromAmbient,
} from "../src/sun-glass-sky.js";

test("theme preferences reject invalid colours, opacity and modes", () => {
  assert.deepEqual(
    normalizeThemePreferences({
      preset: "missing",
      accent: "rainbow",
      card: "#fff",
      cardOpacity: 4,
      appearance: "system",
    }),
    DEFAULT_THEME_PREFERENCES,
  );
});

test("global glass accepts the full transparent-to-frosted range", () => {
  assert.equal(normalizeThemePreferences({ cardOpacity: 0 }).cardOpacity, 0);
  assert.equal(normalizeThemePreferences({ cardOpacity: 1 }).cardOpacity, 1);
  assert.equal(
    normalizeThemePreferences({ cardOpacity: 0.27 }).cardOpacity,
    0.27,
  );
});

test("production sky preserves the accepted prototype colour stops and weather mapping", () => {
  const sunrise = getSunGlassSky(450);
  const sunset = getSunGlassSky(1080);
  const night = getSunGlassSky(1320);

  assert.equal(sunrise.colors[0], "rgb(156 200 220)");
  assert.equal(sunset.colors.at(-1), "rgb(255 73 63)");
  assert.ok(night.night > 0.9);
  assert.ok(night.milkyOpacity > 0.8);
  assert.equal(weatherModeFromAmbient({ weatherCode: 0 }), "clear");
  assert.equal(weatherModeFromAmbient({ weatherCode: 63 }), "rain");
  assert.equal(weatherModeFromAmbient({ weatherCode: 95 }), "storm");
});

test("the China-time light cycle resolves deterministic phases and shadows", () => {
  const dawn = getCelestialSnapshot(
    new Date("2026-07-27T22:30:00.000Z"),
    "auto",
  );
  const night = getCelestialSnapshot(
    new Date("2026-07-27T15:30:00.000Z"),
    "auto",
  );
  const repeated = getCelestialSnapshot(
    new Date("2026-07-27T15:30:00.000Z"),
    "auto",
  );

  assert.equal(dawn.phase, "dawn");
  assert.equal(dawn.resolvedAppearance, "day");
  assert.equal(night.phase, "night");
  assert.equal(night.resolvedAppearance, "night");
  assert.equal(night.pattern, repeated.pattern);
  assert.equal(night.lightSource, "fallback");
  assert.match(night.sunrise, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(night.sunset, /^\d{4}-\d{2}-\d{2}T/);
});

test("location drives the local astronomical sunrise and sunset", () => {
  const date = new Date("2026-07-28T04:00:00.000Z");
  const schedule = getSolarSchedule(date, {
    latitude: 31.23,
    longitude: 121.47,
  });
  const snapshot = getCelestialSnapshot(date, "auto", {
    latitude: 31.23,
    longitude: 121.47,
  });

  assert.equal(schedule.source, "location");
  assert.ok(schedule.sunrise < schedule.sunset);
  assert.equal(snapshot.lightSource, "location");
  assert.equal(snapshot.sunriseLabel, formatSolarTime(schedule.sunrise));
  assert.ok(snapshot.progress >= 0 && snapshot.progress <= 1);
});

test("theme colours reach the sky and shared optical-glass material", () => {
  const values = new Map();
  const root = {
    dataset: {},
    style: {
      setProperty(name, value) {
        values.set(name, value);
      },
    },
  };
  applyThemePreferences(
    {
      ...DEFAULT_THEME_PREFERENCES,
      accent: "#345678",
      card: "#abcdef",
    },
    getCelestialSnapshot(new Date("2026-07-28T04:00:00.000Z"), "day"),
    root,
  );

  assert.equal(values.get("--theme-accent-rgb"), "52 86 120");
  assert.equal(values.get("--theme-card-source-rgb"), "171 205 239");
  assert.equal(
    values.get("--theme-card-rgb"),
    "237 241 243",
    "high-chroma custom card colours must be softened into optical glass",
  );
  assert.equal(values.get("--theme-wallpaper-tint-rgb"), "52 86 120");
  assert.ok(values.has("--theme-glass-highlight"));
  assert.ok(values.has("--theme-glass-shadow"));
  assert.equal(values.get("--sun-light-intensity"), "1");
  assert.equal(values.get("--moon-light-intensity"), "1");
  assert.ok(values.has("--dengta-glass-panel-alpha"));
  assert.ok(values.has("--dengta-glass-bubble-alpha"));
  assert.ok(values.has("--dengta-glass-panel-blur"));
  assert.ok(values.has("--dengta-glass-saturation"));

  const styles = fs.readFileSync(
    new URL("../src/native-feel.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.message-list\s*\{[\s\S]*?--theme-background-rgb[\s\S]*?background-blend-mode:/,
    "the transparent chat wash must share the live theme background",
  );
  assert.doesNotMatch(
    styles,
    /xiaodeng-taotao-chat-wallpaper/,
    "the retired generated wallpaper must not remain in the chat cascade",
  );
  assert.match(
    styles,
    /\.message-row\.assistant \.message-bubble[\s\S]*?--theme-card-rgb/,
    "assistant glass must use the same live card colour as Theme Studio",
  );
});

test("sun glass point lights stay at fixed full intensity without settings sliders", () => {
  const backdrop = fs.readFileSync(
    new URL("../src/CelestialBackdrop.jsx", import.meta.url),
    "utf8",
  );
  const styles = fs.readFileSync(
    new URL("../src/sun-glass-ui.css", import.meta.url),
    "utf8",
  );
  const studio = fs.readFileSync(
    new URL("../src/ThemeStudio.jsx", import.meta.url),
    "utf8",
  );

  assert.match(backdrop, /className="celestial-moon"/);
  assert.match(backdrop, /\["--moon-x", `\$\{sky\.moonX\}%`\]/);
  assert.match(styles, /\.celestial-prototype-sky > \.celestial-sun[\s\S]*?--sun-light-intensity/);
  assert.match(styles, /\.celestial-prototype-sky > \.celestial-moon[\s\S]*?--moon-light-intensity/);
  assert.match(styles, /\.celestial-prototype-sky \.celestial-milky-way[\s\S]*?--moon-light-intensity/);
  assert.doesNotMatch(studio, /Sunlight|Moonlight|sunIntensity|moonIntensity/);
});

test("daylight snapshots expose continuous sunrise, sunset and blue-hour aura", () => {
  const dawn = getCelestialSnapshot(
    new Date("2026-07-27T22:30:00.000Z"),
    "auto",
  );
  const sunset = getCelestialSnapshot(
    new Date("2026-07-28T10:55:00.000Z"),
    "auto",
  );

  for (const snapshot of [dawn, sunset]) {
    assert.ok(snapshot.sunriseAura >= 0 && snapshot.sunriseAura <= 1);
    assert.ok(snapshot.sunsetAura >= 0 && snapshot.sunsetAura <= 1);
    assert.ok(snapshot.blueHourAura >= 0 && snapshot.blueHourAura <= 1);
  }
  assert.ok(dawn.sunriseAura > dawn.sunsetAura);
  assert.ok(sunset.sunsetAura > sunset.sunriseAura);
});

test("night mode exposes readable semantic text and control tokens", () => {
  const values = new Map();
  const root = {
    dataset: {},
    style: {
      setProperty(name, value) {
        values.set(name, value);
      },
    },
  };
  applyThemePreferences(
    DEFAULT_THEME_PREFERENCES,
    getCelestialSnapshot(new Date("2026-07-28T15:30:00.000Z"), "night"),
    root,
  );

  assert.equal(root.dataset.dengtaAppearance, "night");
  assert.match(values.get("--theme-muted"), /rgb\(/);
  assert.match(values.get("--theme-ink-soft"), /rgb\(/);
  assert.match(values.get("--theme-control-border"), /rgb\(/);
  assert.match(values.get("--theme-control-background"), /rgb\(/);

  const styles = fs.readFileSync(
    new URL("../src/native-feel.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /:root\[data-dengta-appearance="night"\][\s\S]*?--muted:\s*var\(--theme-muted\)/,
  );
  assert.match(
    styles,
    /:root\[data-dengta-appearance="night"\][\s\S]*?creative-invitation-card[\s\S]*?--theme-control-border/,
  );
  assert.doesNotMatch(
    styles,
    /data-dengta-appearance="night"[^{}]*\{[^}]*filter:\s*invert/i,
    "night mode must not invert images and glass highlights",
  );
});

test("settings opens over the bright fluid-glass field", () => {
  const app = fs.readFileSync(
    new URL("../src/App.jsx", import.meta.url),
    "utf8",
  );
  const field = fs.readFileSync(
    new URL("../src/SettingsFlowField.jsx", import.meta.url),
    "utf8",
  );
  const styles = fs.readFileSync(
    new URL("../src/sun-glass-ui.css", import.meta.url),
    "utf8",
  );

  assert.match(app, /<SettingsFlowField\s*\/>/);
  assert.match(field, /getContext\("webgl"/);
  assert.match(field, /const LOOP_SECONDS = 15\.466667/);
  assert.match(field, /settings-flow-canvas/);
  assert.match(field, /settings-flow-field--fallback/);
  assert.match(field, /vec3\(0\.04, 0\.48, 0\.04\)/);
  assert.match(field, /vec3\(0\.91, 0\.08, 0\.58\)/);
  assert.match(field, /vec3\(0\.02, 0\.34, 0\.7\)/);
  assert.match(styles, /\.settings-sheet\s*\{[\s\S]*?isolation:\s*isolate/);
  assert.match(styles, /\.settings-flow-canvas\s*\{[\s\S]*?transform:\s*translateZ\(0\)/);
  assert.doesNotMatch(
    styles,
    /\.settings-flow-field\s*\{[^}]*background:\s*#0{3,6}/,
    "the Settings reference must be reflected onto a bright field instead of copied onto black",
  );
});
