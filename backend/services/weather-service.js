const {
    DEFAULT_ENVIRONMENT_TIMEZONE,
    buildWeatherSummary,
    sanitizeWeatherSnapshot
} = require("./environment-context");

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_WEATHER_CACHE_TTL_MS = 12 * 60 * 1000;
const DEFAULT_WEATHER_TIMEOUT_MS = 5_500;
const MAX_WEATHER_RESPONSE_BYTES = 128 * 1024;

function serviceError(message, status, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function parseCoordinate(value, fieldName, minimum, maximum) {
    if (
        (typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value.trim()))
    ) {
        throw serviceError(`${fieldName} 必须是数字。`, 400, "INVALID_COORDINATE");
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
        throw serviceError(
            `${fieldName} 超出允许范围。`,
            400,
            "INVALID_COORDINATE"
        );
    }
    return number;
}

function normalizeWeatherCoordinates(latitudeValue, longitudeValue) {
    const latitude = parseCoordinate(latitudeValue, "latitude", -90, 90);
    const longitude = parseCoordinate(longitudeValue, "longitude", -180, 180);

    // City-scale precision is sufficient for weather and avoids retaining exact GPS.
    return {
        latitude: Math.round(latitude * 100) / 100,
        longitude: Math.round(longitude * 100) / 100
    };
}

function openMeteoTimestamp(value) {
    const text = String(value || "").trim();
    if (!text) return new Date().toISOString();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) {
        return `${text}+08:00`;
    }
    return text;
}

function firstArrayValue(value) {
    return Array.isArray(value) ? value[0] : undefined;
}

async function readBoundedResponseBody(response) {
    const contentLength = Number(response.headers?.get("content-length"));
    if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_WEATHER_RESPONSE_BYTES
    ) {
        throw serviceError(
            "天气服务返回的数据过大。",
            502,
            "WEATHER_UPSTREAM_INVALID"
        );
    }

    if (response.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        const chunks = [];
        let totalBytes = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = Buffer.from(value);
                totalBytes += chunk.length;
                if (totalBytes > MAX_WEATHER_RESPONSE_BYTES) {
                    await reader.cancel();
                    throw serviceError(
                        "天气服务返回的数据过大。",
                        502,
                        "WEATHER_UPSTREAM_INVALID"
                    );
                }
                chunks.push(chunk);
            }
        } finally {
            reader.releaseLock();
        }
        return Buffer.concat(chunks, totalBytes).toString("utf8");
    }

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_WEATHER_RESPONSE_BYTES) {
        throw serviceError(
            "天气服务返回的数据过大。",
            502,
            "WEATHER_UPSTREAM_INVALID"
        );
    }
    return body;
}

function parseOpenMeteoPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw serviceError(
            "天气服务返回了无效数据。",
            502,
            "WEATHER_UPSTREAM_INVALID"
        );
    }
    const current =
        payload.current && typeof payload.current === "object"
            ? payload.current
            : {};
    const daily =
        payload.daily && typeof payload.daily === "object" ? payload.daily : {};
    const weather = sanitizeWeatherSnapshot({
        weather_code: current.weather_code,
        temperature_c: current.temperature_2m,
        apparent_temperature_c: current.apparent_temperature,
        humidity_percent: current.relative_humidity_2m,
        precipitation_mm: current.precipitation,
        wind_speed_kmh: current.wind_speed_10m,
        daily_low_c: firstArrayValue(daily.temperature_2m_min),
        daily_high_c: firstArrayValue(daily.temperature_2m_max),
        precipitation_probability_percent: firstArrayValue(
            daily.precipitation_probability_max
        ),
        is_day: current.is_day,
        observed_at: openMeteoTimestamp(current.time),
        source: "open-meteo"
    });
    if (!weather || weather.temperature_c === undefined) {
        throw serviceError(
            "天气服务没有返回当前温度。",
            502,
            "WEATHER_UPSTREAM_INVALID"
        );
    }
    return {
        ...weather,
        summary: buildWeatherSummary(weather),
        timezone: DEFAULT_ENVIRONMENT_TIMEZONE
    };
}

function createWeatherService({
    fetchImpl = (...args) => globalThis.fetch(...args),
    cacheTtlMs = DEFAULT_WEATHER_CACHE_TTL_MS,
    timeoutMs = DEFAULT_WEATHER_TIMEOUT_MS,
    now = () => Date.now()
} = {}) {
    const safeCacheTtlMs = Math.min(
        15 * 60 * 1000,
        Math.max(10 * 60 * 1000, Number(cacheTtlMs) || DEFAULT_WEATHER_CACHE_TTL_MS)
    );
    const safeTimeoutMs = Math.min(
        15_000,
        Math.max(1_000, Number(timeoutMs) || DEFAULT_WEATHER_TIMEOUT_MS)
    );
    const cache = new Map();
    const inFlight = new Map();

    function currentTime() {
        const value = typeof now === "function" ? now() : now;
        return Number(value) || Date.now();
    }

    function prune(timestamp) {
        for (const [key, entry] of cache) {
            if (entry.expiresAt <= timestamp) cache.delete(key);
        }
        while (cache.size > 500) {
            cache.delete(cache.keys().next().value);
        }
    }

    async function requestWeather(coordinates) {
        const url = new URL(OPEN_METEO_ENDPOINT);
        url.searchParams.set("latitude", coordinates.latitude.toFixed(2));
        url.searchParams.set("longitude", coordinates.longitude.toFixed(2));
        url.searchParams.set(
            "current",
            [
                "temperature_2m",
                "apparent_temperature",
                "relative_humidity_2m",
                "precipitation",
                "weather_code",
                "cloud_cover",
                "wind_speed_10m",
                "is_day"
            ].join(",")
        );
        url.searchParams.set(
            "daily",
            [
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_probability_max"
            ].join(",")
        );
        url.searchParams.set("forecast_days", "1");
        url.searchParams.set("timezone", DEFAULT_ENVIRONMENT_TIMEZONE);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), safeTimeoutMs);
        try {
            const response = await fetchImpl(url, {
                method: "GET",
                headers: { Accept: "application/json" },
                signal: controller.signal
            });
            if (!response?.ok) {
                throw serviceError(
                    "天气服务暂时不可用。",
                    502,
                    "WEATHER_UPSTREAM_ERROR"
                );
            }
            const body = await readBoundedResponseBody(response);
            let payload;
            try {
                payload = JSON.parse(body);
            } catch {
                throw serviceError(
                    "天气服务返回了无效数据。",
                    502,
                    "WEATHER_UPSTREAM_INVALID"
                );
            }
            return parseOpenMeteoPayload(payload);
        } catch (error) {
            if (error?.name === "AbortError") {
                throw serviceError(
                    "天气服务响应超时。",
                    504,
                    "WEATHER_UPSTREAM_TIMEOUT"
                );
            }
            if (error?.status) throw error;
            throw serviceError(
                "天气服务连接失败。",
                502,
                "WEATHER_UPSTREAM_ERROR"
            );
        } finally {
            clearTimeout(timeout);
        }
    }

    async function getCurrentWeather({ latitude, longitude } = {}) {
        const coordinates = normalizeWeatherCoordinates(latitude, longitude);
        const cacheKey = `${coordinates.latitude.toFixed(2)},${coordinates.longitude.toFixed(2)}`;
        const timestamp = currentTime();
        prune(timestamp);
        const cached = cache.get(cacheKey);
        if (cached && cached.expiresAt > timestamp) {
            return { weather: { ...cached.weather }, cached: true };
        }
        if (inFlight.has(cacheKey)) {
            const weather = await inFlight.get(cacheKey);
            return { weather: { ...weather }, cached: true };
        }

        const request = requestWeather(coordinates);
        inFlight.set(cacheKey, request);
        try {
            const weather = await request;
            cache.set(cacheKey, {
                weather,
                expiresAt: currentTime() + safeCacheTtlMs
            });
            return { weather: { ...weather }, cached: false };
        } finally {
            inFlight.delete(cacheKey);
        }
    }

    return { getCurrentWeather };
}

module.exports = {
    DEFAULT_WEATHER_CACHE_TTL_MS,
    DEFAULT_WEATHER_TIMEOUT_MS,
    OPEN_METEO_ENDPOINT,
    createWeatherService,
    normalizeWeatherCoordinates,
    parseOpenMeteoPayload
};
