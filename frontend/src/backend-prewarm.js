import { API_BASE_URL } from "./api.js";

export const BACKEND_PREWARM_DEDUPE_MS = 45_000;

export function createBackendPrewarmer({
  baseUrl = API_BASE_URL,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  dedupeMs = BACKEND_PREWARM_DEDUPE_MS,
} = {}) {
  let inFlight = null;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let lastResult = null;
  const wakeUrl = `${String(baseUrl || "").replace(/\/$/, "")}/`;

  return function prewarmBackend() {
    const currentTime = Number(now()) || 0;
    if (inFlight) return inFlight;
    if (lastResult && currentTime - lastAttemptAt < dedupeMs) {
      return lastResult;
    }

    lastAttemptAt = currentTime;
    let request;
    try {
      request = fetchImpl(wakeUrl, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      request = Promise.reject(error);
    }
    const run = Promise.resolve(request)
      .then((response) => ({
        ok: response?.ok === true,
        status: Number(response?.status) || 0,
      }))
      .catch(() => ({ ok: false, status: 0 }));

    inFlight = run;
    lastResult = run;
    void run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  };
}

export const prewarmBackend = createBackendPrewarmer();
