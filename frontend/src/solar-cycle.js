const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const J0 = 0.0009;
const OBLIQUITY = RAD * 23.4397;
const PERIHELION = RAD * 102.9372;
const DEFAULT_COORDINATES = Object.freeze({
  latitude: 31.23,
  longitude: 121.47,
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toJulian(date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970;
}

function fromJulian(value) {
  return new Date((value + 0.5 - J1970) * DAY_MS);
}

function toDays(date) {
  return toJulian(date) - J2000;
}

function solarMeanAnomaly(day) {
  return RAD * (357.5291 + 0.98560028 * day);
}

function eclipticLongitude(meanAnomaly) {
  const equationOfCenter =
    RAD *
    (1.9148 * Math.sin(meanAnomaly) +
      0.02 * Math.sin(2 * meanAnomaly) +
      0.0003 * Math.sin(3 * meanAnomaly));
  return meanAnomaly + equationOfCenter + PERIHELION + Math.PI;
}

function declination(longitude) {
  return Math.asin(Math.sin(longitude) * Math.sin(OBLIQUITY));
}

function julianCycle(day, longitudeWest) {
  return Math.round(day - J0 - longitudeWest / (2 * Math.PI));
}

function approxTransit(hourAngle, longitudeWest, cycle) {
  return J0 + (hourAngle + longitudeWest) / (2 * Math.PI) + cycle;
}

function solarTransitJulian(transit, meanAnomaly, longitude) {
  return (
    J2000 +
    transit +
    0.0053 * Math.sin(meanAnomaly) -
    0.0069 * Math.sin(2 * longitude)
  );
}

function hourAngle(altitude, latitude, solarDeclination) {
  const ratio =
    (Math.sin(altitude) -
      Math.sin(latitude) * Math.sin(solarDeclination)) /
    (Math.cos(latitude) * Math.cos(solarDeclination));
  if (ratio < -1 || ratio > 1) return null;
  return Math.acos(ratio);
}

function solarSetJulian(
  altitude,
  longitudeWest,
  latitude,
  solarDeclination,
  cycle,
  meanAnomaly,
  longitude,
) {
  const angle = hourAngle(altitude, latitude, solarDeclination);
  if (angle === null) return null;
  const transit = approxTransit(angle, longitudeWest, cycle);
  return solarTransitJulian(transit, meanAnomaly, longitude);
}

function chinaDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function normalizeCoordinates(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { ...DEFAULT_COORDINATES, source: "fallback" };
  }
  return { latitude, longitude, source: "location" };
}

function dateAtChinaNoon(parts, dayOffset = 0) {
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day) + dayOffset,
      4,
      0,
      0,
    ),
  );
}

function fallbackSchedule(parts, dayOffset, coordinates) {
  const midnight = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) + dayOffset,
    -8,
  );
  return Object.freeze({
    dateKey: new Date(midnight + 12 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    coordinates,
    source: coordinates.source,
    solarNoon: new Date(midnight + 12 * 60 * 60 * 1000),
    civilDawn: new Date(midnight + 5.5 * 60 * 60 * 1000),
    sunrise: new Date(midnight + 6 * 60 * 60 * 1000),
    sunset: new Date(midnight + 18 * 60 * 60 * 1000),
    civilDusk: new Date(midnight + 18.5 * 60 * 60 * 1000),
  });
}

export function getSolarSchedule(
  date = new Date(),
  coordinateValue,
  dayOffset = 0,
) {
  const coordinates = normalizeCoordinates(coordinateValue);
  const parts = chinaDateParts(date);
  const anchor = dateAtChinaNoon(parts, dayOffset);
  const longitudeWest = RAD * -coordinates.longitude;
  const latitude = RAD * coordinates.latitude;
  const day = toDays(anchor);
  const cycle = julianCycle(day, longitudeWest);
  const transit = approxTransit(0, longitudeWest, cycle);
  const meanAnomaly = solarMeanAnomaly(transit);
  const longitude = eclipticLongitude(meanAnomaly);
  const solarDeclination = declination(longitude);
  const solarNoonJulian = solarTransitJulian(
    transit,
    meanAnomaly,
    longitude,
  );
  const sunsetJulian = solarSetJulian(
    -0.833 * RAD,
    longitudeWest,
    latitude,
    solarDeclination,
    cycle,
    meanAnomaly,
    longitude,
  );
  const civilDuskJulian = solarSetJulian(
    -6 * RAD,
    longitudeWest,
    latitude,
    solarDeclination,
    cycle,
    meanAnomaly,
    longitude,
  );

  if (sunsetJulian === null || civilDuskJulian === null) {
    return fallbackSchedule(parts, dayOffset, coordinates);
  }

  const solarNoon = fromJulian(solarNoonJulian);
  const sunset = fromJulian(sunsetJulian);
  const civilDusk = fromJulian(civilDuskJulian);
  const sunrise = fromJulian(solarNoonJulian - (sunsetJulian - solarNoonJulian));
  const civilDawn = fromJulian(
    solarNoonJulian - (civilDuskJulian - solarNoonJulian),
  );

  return Object.freeze({
    dateKey: chinaDateParts(anchor).year +
      `-${chinaDateParts(anchor).month}-${chinaDateParts(anchor).day}`,
    coordinates,
    source: coordinates.source,
    solarNoon,
    civilDawn,
    sunrise,
    sunset,
    civilDusk,
  });
}

export function phaseProgress(now, start, end) {
  const duration = end.valueOf() - start.valueOf();
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clamp((now.valueOf() - start.valueOf()) / duration);
}

export function formatSolarTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
