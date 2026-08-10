import assert from "node:assert/strict";
import fs from "node:fs";
import {
  readOrCreateNotificationDeviceId,
  resolveBackgroundNotificationIdentity,
  startBackgroundNotificationIdentitySync,
} from "../src/background-notification-identity.js";
import { AUTH_STATUS } from "../src/auth-session.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANION_ID = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES_AT = "2026-08-26T12:00:00.000Z";

const notificationIdentitySource = fs.readFileSync(
  new URL("../src/background-notification-identity.js", import.meta.url),
  "utf8",
);
assert.match(
  notificationIdentitySource,
  /timeoutMs:\s*BACKEND_WAKE_TIMEOUT_MS/,
  "notification registration must survive the same backend cold-start window",
);

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const deviceStorage = createStorage();
assert.equal(
  readOrCreateNotificationDeviceId(deviceStorage, () => DEVICE_ID),
  DEVICE_ID,
);
assert.equal(
  readOrCreateNotificationDeviceId(deviceStorage, () => {
    throw new Error("must reuse the stored installation id");
  }),
  DEVICE_ID,
);

const anonymousAction = await resolveBackgroundNotificationIdentity(
  { status: AUTH_STATUS.anonymous, user: null },
  { getRequestContext: async () => ({}) },
  {
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async () => {
      throw new Error("anonymous users must not register installations");
    },
  },
);
assert.deepEqual(anonymousAction, { method: "clear", payload: {} });

const authenticatedAction = await resolveBackgroundNotificationIdentity(
  {
    status: AUTH_STATUS.authenticated,
    user: { id: USER_ID },
  },
  {
    getRequestContext: async () => ({
      accessToken: "private-access-token",
      companionId: COMPANION_ID,
    }),
  },
  {
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async (deviceId) => {
      assert.equal(deviceId, DEVICE_ID);
      return {
        installation_token: "private-installation-token",
        companion_id: COMPANION_ID,
        expires_at: EXPIRES_AT,
      };
    },
  },
);
assert.deepEqual(authenticatedAction, {
  method: "configure",
  payload: {
    installationToken: "private-installation-token",
    expiresAt: Date.parse(EXPIRES_AT),
    deviceId: DEVICE_ID,
    companionId: COMPANION_ID,
    userId: USER_ID,
  },
});

assert.deepEqual(
  await resolveBackgroundNotificationIdentity(
    {
      status: AUTH_STATUS.authenticated,
      user: { id: USER_ID },
    },
    {
      getRequestContext: async () => ({
        accessToken: "private-access-token",
        companionId: "",
      }),
    },
    {
      storage: createStorage(),
      randomUUID: () => DEVICE_ID,
      register: async () => {
        throw new Error("missing companion must not register");
      },
    },
  ),
  { method: "clear", payload: {} },
  "a worker without a companion scope must not fall back to another tenant",
);

{
  let listener = null;
  let context = {
    accessToken: "access-a",
    companionId: COMPANION_ID,
  };
  const calls = [];
  const manager = {
    subscribe(next) {
      listener = next;
      next({
        status: AUTH_STATUS.authenticated,
        user: { id: USER_ID },
      });
      return () => {
        listener = null;
      };
    },
    async getRequestContext() {
      return context;
    },
  };
  const plugin = {
    async configure(payload) {
      calls.push({ method: "configure", payload });
    },
    async clear() {
      calls.push({ method: "clear" });
    },
  };
  const capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  };
  const stop = startBackgroundNotificationIdentitySync(manager, {
    capacitor,
    plugin,
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async () => ({
      installation_token: "install-a",
      companion_id: COMPANION_ID,
      expires_at: EXPIRES_AT,
    }),
    onError(error) {
      throw error;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0].method, "configure");
  assert.equal(calls[0].payload.installationToken, "install-a");

  context = {};
  listener({
    status: AUTH_STATUS.anonymous,
    user: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.at(-1).method, "clear");
  stop();
  assert.equal(listener, null);
}

{
  let listener = null;
  let releaseRegistration;
  let registrationStarted;
  const registrationStartedPromise = new Promise((resolve) => {
    registrationStarted = resolve;
  });
  const registrationPromise = new Promise((resolve) => {
    releaseRegistration = resolve;
  });
  const calls = [];
  const manager = {
    subscribe(next) {
      listener = next;
      next({
        status: AUTH_STATUS.authenticated,
        user: { id: USER_ID },
      });
      return () => {
        listener = null;
      };
    },
    async getRequestContext() {
      return {
        accessToken: "access-before-logout",
        companionId: COMPANION_ID,
      };
    },
  };
  const stop = startBackgroundNotificationIdentitySync(manager, {
    capacitor: {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
    },
    plugin: {
      async configure(payload) {
        calls.push({ method: "configure", payload });
      },
      async clear() {
        calls.push({ method: "clear" });
      },
    },
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async () => {
      registrationStarted();
      return registrationPromise;
    },
    onError(error) {
      throw error;
    },
  });

  await registrationStartedPromise;
  listener({
    status: AUTH_STATUS.anonymous,
    user: null,
  });
  releaseRegistration({
    installation_token: "stale-installation-token",
    companion_id: COMPANION_ID,
    expires_at: EXPIRES_AT,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    calls,
    [{ method: "clear" }],
    "a registration that finishes after logout must never re-enable native notifications",
  );
  stop();
}

{
  let listener = null;
  let registerCalls = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const configured = [];
  const manager = {
    subscribe(next) {
      listener = next;
      next({
        status: AUTH_STATUS.authenticated,
        user: { id: USER_ID },
      });
      return () => {
        listener = null;
      };
    },
    async getRequestContext() {
      return {
        accessToken: "retry-access-token",
        companionId: COMPANION_ID,
      };
    },
  };
  const stop = startBackgroundNotificationIdentitySync(manager, {
    capacitor: {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
    },
    plugin: {
      async configure(payload) {
        configured.push(payload);
      },
      async clear() {},
    },
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async () => {
      registerCalls += 1;
      if (registerCalls === 1) throw new Error("backend waking up");
      return {
        installation_token: "retry-installation-token",
        companion_id: COMPANION_ID,
        expires_at: EXPIRES_AT,
      };
    },
    retryDelays: [25],
    setTimeoutFn(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    onError() {},
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(registerCalls, 1);
  assert.deepEqual(
    [...timers.values()].map(({ delay }) => delay),
    [25],
    "a temporary installation registration failure must schedule a retry",
  );

  const retryTimer = [...timers.entries()][0];
  timers.delete(retryTimer[0]);
  retryTimer[1].callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(registerCalls, 2);
  assert.equal(configured.length, 1);
  assert.equal(
    configured[0].installationToken,
    "retry-installation-token",
  );
  assert.equal(timers.size, 0);
  stop();
  assert.equal(listener, null);
}

const workerSource = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/PushNotificationWorker.java",
    import.meta.url,
  ),
  "utf8",
);
const credentialsSource = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/BackgroundNotificationCredentials.java",
    import.meta.url,
  ),
  "utf8",
);
const pluginSource = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/BackgroundNotificationsPlugin.java",
    import.meta.url,
  ),
  "utf8",
);
const activitySource = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/MainActivity.java",
    import.meta.url,
  ),
  "utf8",
);
assert.match(workerSource, /\/api\/v2\/settings/);
assert.match(workerSource, /\/api\/v2\/push\/messages/);
assert.doesNotMatch(
  workerSource,
  /!settings\.optBoolean\("push_enabled", false\)/,
  "manual and co-watch push messages must still be delivered when autonomous generation is disabled",
);
assert.doesNotMatch(
  workerSource,
  /settings == null[\s\S]{0,160}putString\(CURSOR_KEY, nowIso\(\)\)/,
  "a missing settings payload must not advance the cursor and discard pending push messages",
);
assert.match(workerSource, /X-DengTa-Companion-Id/);
assert.match(workerSource, /cancelUniqueWork/);
assert.match(workerSource, /X-DengTa-Installation-Token/);
assert.match(workerSource, /private static final int MAX_SEEN_IDS = 200/);
assert.match(workerSource, /!seenIds\.contains\(id\)/);
assert.match(workerSource, /serializeSeenIds\(seenIds\)/);
assert.match(workerSource, /if \(scopeChanged\)/);
assert.match(workerSource, /\.putString\(SEEN_IDS_KEY, "\[\]"\)/);
assert.match(pluginSource, /BackgroundNotificationCredentials\.clear/);
assert.match(pluginSource, /PushNotificationWorker\.clear/);
assert.match(activitySource, /public void onPause\(\)/);
assert.match(activitySource, /PushNotificationWorker\.markAppVisible/);
assert.match(credentialsSource, /AndroidKeyStore/);
assert.match(credentialsSource, /AES\/GCM\/NoPadding/);
assert.match(
  credentialsSource,
  /cipher\.init\(\s*Cipher\.ENCRYPT_MODE,\s*getOrCreateKey\(\)\s*\)/,
  "Android Keystore must generate the AES-GCM encryption IV",
);
assert.match(
  credentialsSource,
  /byte\[\]\s+iv\s*=\s*cipher\.getIV\(\)/,
  "the generated AES-GCM IV must be persisted with the ciphertext",
);
assert.doesNotMatch(
  credentialsSource,
  /putString\([^,]*installation_token[^,]*,\s*installationToken/,
);

console.log("Android 后台通知登录身份、伴侣隔离与本地凭据保护测试通过。");
