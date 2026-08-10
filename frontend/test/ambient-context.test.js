import assert from "node:assert/strict";
import {
  AMBIENT_LOCATION_CACHE_KEY,
  AMBIENT_PREFERENCES_KEY,
  AMBIENT_WEATHER_CACHE_KEY,
  buildAmbientContext,
  clearCachedWeather,
  describeGeolocationError,
  formatShanghaiClock,
  normalizeAmbientPreferences,
  normalizeCoordinates,
  normalizeWeather,
  readAmbientPreferences,
  readCachedCoordinates,
  readCachedWeather,
  resolveAmbientStartupAction,
  resolveAmbientSwipe,
  storeAmbientPreferences,
  storeCachedCoordinates,
  storeCachedWeather,
} from "../src/ambient-context.js";
import {
  STICKER_CATALOG,
  findStickersByMood,
  getStickerAssetPath,
  getStickerById,
  isStickerId,
  selectStickerByMood,
} from "../src/sticker-catalog.js";

const clock = formatShanghaiClock("2026-07-23T11:05:00Z");
assert.equal(clock.time, "19:05");
assert.match(clock.date, /7月23日/);
assert.equal(clock.dateTime, "2026-07-23T19:05:00+08:00");

assert.deepEqual(normalizeCoordinates({ latitude: 31.230416, longitude: 121.473701 }), {
  latitude: 31.23,
  longitude: 121.47,
});
assert.equal(normalizeCoordinates({ latitude: 100, longitude: 0 }), null);

const values = new Map();
const storage = {
  getItem(key) {
    return values.get(key) || null;
  },
  setItem(key, value) {
    values.set(key, value);
  },
  removeItem(key) {
    values.delete(key);
  },
};

assert.equal(
  storeCachedCoordinates(
    { latitude: 31.230416, longitude: 121.473701, accuracy: 18.4 },
    storage,
    1_000,
  ),
  true,
);
assert.equal(readCachedCoordinates(storage, 2_000, 10_000).state, "fresh");
assert.deepEqual(
  readCachedCoordinates(storage, 2_000, 10_000).coordinates,
  { latitude: 31.23, longitude: 121.47, accuracy: 18 },
);
assert.deepEqual(readCachedCoordinates(storage, 12_000, 10_000), {
  state: "stale",
  coordinates: {
    latitude: 31.23,
    longitude: 121.47,
    accuracy: 18,
  },
  ageMs: 11_000,
});
assert.equal(
  values.has(AMBIENT_LOCATION_CACHE_KEY),
  true,
  "stale rounded coordinates must remain available without another prompt",
);

assert.deepEqual(normalizeAmbientPreferences(null), {
  enabled: false,
  minimized: false,
  side: "right",
  permissionDenied: false,
});
assert.equal(readAmbientPreferences(storage).state, "missing");
assert.equal(
  storeAmbientPreferences(
    {
      enabled: true,
      minimized: true,
      side: "left",
      permissionDenied: true,
    },
    storage,
  ),
  true,
);
assert.deepEqual(readAmbientPreferences(storage), {
  state: "ready",
  preferences: {
    enabled: true,
    minimized: true,
    side: "left",
    permissionDenied: true,
  },
});
values.set(
  AMBIENT_PREFERENCES_KEY,
  JSON.stringify({ enabled: "yes", side: "bottom" }),
);
assert.deepEqual(readAmbientPreferences(storage).preferences, {
  enabled: false,
  minimized: false,
  side: "right",
  permissionDenied: false,
});
values.set(AMBIENT_PREFERENCES_KEY, "{bad-json");
assert.equal(readAmbientPreferences(storage).state, "invalid");
assert.equal(values.has(AMBIENT_PREFERENCES_KEY), false);

values.set(AMBIENT_LOCATION_CACHE_KEY, "{bad-json");
assert.equal(readCachedCoordinates(storage).state, "invalid");
assert.equal(values.has(AMBIENT_LOCATION_CACHE_KEY), false);

assert.equal(describeGeolocationError({ code: 1 }).state, "denied");
assert.equal(describeGeolocationError({ code: 3 }).state, "timeout");
assert.equal(describeGeolocationError({ code: 2 }).state, "unavailable");

const weather = normalizeWeather({
  current: {
    temperature_2m: 27.34,
    weather_code: 2,
    wind_speed_10m: 8.45,
    time: "2026-07-23T19:00",
  },
});
assert.deepEqual(weather, {
  temperatureC: 27.3,
  description: "局部多云",
  weatherCode: 2,
  windSpeedKmh: 8.5,
  updatedAt: "2026-07-23T19:00",
});
assert.equal(normalizeWeather({ current: {} }), null);

assert.equal(storeCachedWeather(weather, storage, 5_000), true);
assert.deepEqual(readCachedWeather(storage, 5_500, 1_000), {
  state: "fresh",
  weather,
  ageMs: 500,
});
assert.deepEqual(readCachedWeather(storage, 7_000, 1_000), {
  state: "stale",
  weather,
  ageMs: 2_000,
});
assert.equal(
  values.has(AMBIENT_WEATHER_CACHE_KEY),
  true,
  "stale weather must remain available for an immediate restore",
);
clearCachedWeather(storage);
assert.equal(values.has(AMBIENT_WEATHER_CACHE_KEY), false);
values.set(AMBIENT_WEATHER_CACHE_KEY, "{bad-json");
assert.equal(readCachedWeather(storage).state, "invalid");
assert.equal(values.has(AMBIENT_WEATHER_CACHE_KEY), false);

assert.deepEqual(
  resolveAmbientSwipe({
    startX: 100,
    startY: 100,
    endX: 48,
    endY: 104,
    side: "right",
  }),
  { minimized: true, side: "left" },
);
assert.deepEqual(
  resolveAmbientSwipe({
    startX: 100,
    startY: 100,
    endX: 151,
    endY: 97,
    side: "left",
  }),
  { minimized: true, side: "right" },
);
assert.deepEqual(
  resolveAmbientSwipe({
    startX: 100,
    startY: 100,
    endX: 103,
    endY: 50,
    side: "left",
  }),
  { minimized: true, side: "left" },
);
assert.equal(
  resolveAmbientSwipe({
    startX: 100,
    startY: 100,
    endX: 125,
    endY: 90,
    side: "right",
  }),
  null,
);

assert.equal(
  resolveAmbientStartupAction({
    preferences: { enabled: false },
    weatherState: "missing",
    coordinateState: "missing",
  }),
  "idle",
);
assert.equal(
  resolveAmbientStartupAction({
    preferences: { enabled: true, permissionDenied: true },
    weatherState: "stale",
    coordinateState: "missing",
  }),
  "permission-blocked",
  "a persisted OS denial must not trigger another automatic prompt",
);
assert.equal(
  resolveAmbientStartupAction({
    preferences: { enabled: true },
    weatherState: "fresh",
    coordinateState: "missing",
  }),
  "use-cache",
);
assert.equal(
  resolveAmbientStartupAction({
    preferences: { enabled: true },
    weatherState: "stale",
    coordinateState: "fresh",
  }),
  "load-weather",
);
assert.equal(
  resolveAmbientStartupAction({
    preferences: { enabled: true },
    weatherState: "stale",
    coordinateState: "stale",
  }),
  "request-location",
  "stale coordinates must be refreshed through the already-authorized OS location service",
);
assert.equal(
  resolveAmbientStartupAction({
    preferences: { enabled: true },
    weatherState: "stale",
    coordinateState: "missing",
  }),
  "request-location",
);

const context = buildAmbientContext({
  clock,
  weather,
  locationEnabled: true,
});
assert.deepEqual(context.weather, {
  temperatureC: 27.3,
  description: "局部多云",
  weatherCode: 2,
  windSpeedKmh: 8.5,
  updatedAt: "2026-07-23T19:00",
});
assert.equal("latitude" in context, false);
assert.equal(JSON.stringify(context).includes("121.47"), false);

assert.deepEqual(
  STICKER_CATALOG.map((item) => item.id),
  [
    "bear-sleepy",
    "bear-hug",
    "bear-miss-you",
    "bear-cheer",
    "bear-shy",
    "bear-goodnight",
  ],
);
assert.equal(isStickerId("bear-hug"), true);
assert.equal(isStickerId("../bear-hug"), false);
assert.equal(getStickerById("missing"), null);
assert.equal(getStickerAssetPath("../../secrets"), null);
assert.equal(
  getStickerAssetPath("bear-goodnight"),
  "/assets/stickers/bear-goodnight.jpg",
);
assert.equal(selectStickerByMood(["night", "sleepy"]).id, "bear-sleepy");
assert.deepEqual(
  findStickersByMood(["love", "hug"], { limit: 2 }).map((item) => item.id),
  ["bear-hug", "bear-miss-you"],
);
assert.deepEqual(findStickersByMood(["../../../etc/passwd"]), []);

console.log("frontend ambient context and sticker catalog tests passed");
