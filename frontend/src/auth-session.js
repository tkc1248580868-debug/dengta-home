import { GoTrueClient } from "@supabase/auth-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANION_STORAGE_PREFIX = "dengta_active_companion_id_v1:";
const AUTH_STORAGE_KEY = "dengta_home_auth_v1";

const DEFAULT_SUPABASE_URL = String(
  import.meta.env?.VITE_SUPABASE_URL || "",
).trim();
const DEFAULT_SUPABASE_ANON_KEY = String(
  import.meta.env?.VITE_SUPABASE_ANON_KEY || "",
).trim();

function createAuthOnlyClient(supabaseUrl, supabaseAnonKey, options = {}) {
  return {
    auth: new GoTrueClient({
      url: `${supabaseUrl}/auth/v1`,
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
        "X-Client-Info": "dengta-home/auth-js",
      },
      ...options.auth,
    }),
  };
}

export const AUTH_STATUS = Object.freeze({
  unconfigured: "unconfigured",
  loading: "loading",
  anonymous: "anonymous",
  authenticating: "authenticating",
  recovery: "recovery",
  authenticated: "authenticated",
  expired: "expired",
  error: "error",
});

export class AuthSessionError extends Error {
  constructor(message, { code = "auth_error", status = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AuthSessionError";
    this.code = code;
    this.status = status;
  }
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function storageForBrowser(candidate) {
  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  ) {
    return candidate;
  }
  return undefined;
}

function companionStorageKey(userId) {
  return `${COMPANION_STORAGE_PREFIX}${userId}`;
}

function readCompanionId(storage, userId) {
  if (!storage || !userId) return "";
  try {
    const value = String(storage.getItem(companionStorageKey(userId)) || "");
    return UUID_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}

function storeCompanionId(storage, userId, companionId) {
  if (!storage || !userId || !UUID_PATTERN.test(companionId)) return;
  try {
    storage.setItem(companionStorageKey(userId), companionId);
  } catch {
    // A blocked storage backend only disables companion persistence.
  }
}

function authFailure(error, fallbackMessage) {
  const code = String(error?.code || "auth_error");
  const messages = {
    invalid_credentials: "邮箱或密码不正确。",
    email_not_confirmed: "请先完成邮箱验证，再登录 DengTa Home。",
    user_already_exists: "这个邮箱已经注册，请直接登录。",
    user_already_registered: "这个邮箱已经注册，请直接登录。",
    over_email_send_rate_limit: "验证邮件发送得太频繁，请稍后再试。",
    weak_password: "密码强度不足，请换一个更长、更难猜的密码。",
    validation_failed: "邮箱或密码格式不正确。",
  };
  return new AuthSessionError(
    messages[code] || fallbackMessage || "账号操作失败，请稍后再试。",
    {
      code,
      status: Number(error?.status || 0),
      cause: error,
    },
  );
}

function publicUser(session) {
  const user = session?.user;
  if (!user?.id) return null;
  return Object.freeze({
    id: user.id,
    email: user.email || "",
    displayName: String(user.user_metadata?.display_name || "")
      .trim()
      .slice(0, 80),
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
  });
}

function configured(supabaseUrl, supabaseAnonKey) {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function createAuthSessionManager({
  supabaseUrl = DEFAULT_SUPABASE_URL,
  supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY,
  storage = globalThis.localStorage,
  createClientFn = createAuthOnlyClient,
} = {}) {
  const normalizedUrl = String(supabaseUrl || "").trim().replace(/\/$/, "");
  const normalizedKey = String(supabaseAnonKey || "").trim();
  const persistentStorage = storageForBrowser(storage);
  const listeners = new Set();
  let client = null;
  let initialization = null;
  let authSubscription = null;
  let session = null;
  let passwordRecovery = false;
  let snapshot = Object.freeze({
    status: configured(normalizedUrl, normalizedKey)
      ? AUTH_STATUS.loading
      : AUTH_STATUS.unconfigured,
    user: null,
    activeCompanionId: "",
    error: null,
  });

  function publish(next) {
    snapshot = Object.freeze({ ...snapshot, ...next });
    listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  function applySession(nextSession, status) {
    session = nextSession || null;
    const user = publicUser(session);
    return publish({
      status:
        status ||
        (session ? AUTH_STATUS.authenticated : AUTH_STATUS.anonymous),
      user,
      activeCompanionId: readCompanionId(persistentStorage, user?.id),
      error: null,
    });
  }

  function applyRecoverySession(nextSession) {
    passwordRecovery = true;
    session = nextSession || null;
    const user = publicUser(session);
    return publish({
      status: AUTH_STATUS.recovery,
      user,
      activeCompanionId: readCompanionId(persistentStorage, user?.id),
      error: null,
    });
  }

  function requireConfiguration() {
    if (!configured(normalizedUrl, normalizedKey)) {
      throw new AuthSessionError(
        "DengTa Home 尚未配置 Supabase 登录服务。",
        { code: "auth_not_configured" },
      );
    }
  }

  function ensureClient() {
    requireConfiguration();
    if (client) return client;
    client = createClientFn(normalizedUrl, normalizedKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: persistentStorage,
        storageKey: AUTH_STORAGE_KEY,
      },
    });
    return client;
  }

  async function initialize() {
    if (!configured(normalizedUrl, normalizedKey)) return snapshot;
    if (initialization) return initialization;

    initialization = (async () => {
      const authClient = ensureClient();
      publish({ status: AUTH_STATUS.loading, error: null });

      if (!authSubscription) {
        const result = authClient.auth.onAuthStateChange(
          (event, nextSession) => {
            if (event === "PASSWORD_RECOVERY") {
              applyRecoverySession(nextSession);
              return;
            }
            if (event === "SIGNED_OUT") passwordRecovery = false;
            applySession(
              nextSession,
              passwordRecovery ? AUTH_STATUS.recovery : undefined,
            );
          },
        );
        authSubscription = result?.data?.subscription || null;
      }

      const { data, error } = await authClient.auth.getSession();
      if (error) {
        throw authFailure(error, "无法恢复登录状态，请重新登录。");
      }
      return passwordRecovery
        ? applyRecoverySession(data?.session || null)
        : applySession(data?.session || null);
    })().catch((error) => {
      initialization = null;
      publish({
        status: AUTH_STATUS.error,
        error:
          error instanceof AuthSessionError
            ? error
            : authFailure(error, "无法恢复登录状态，请重新登录。"),
      });
      throw error;
    });

    return initialization;
  }

  async function signUp({
    email,
    password,
    displayName = "",
    emailRedirectTo,
  } = {}) {
    requireConfiguration();
    await initialize();
    publish({ status: AUTH_STATUS.authenticating, error: null });
    const options = {};
    const normalizedDisplayName = String(displayName || "").trim().slice(0, 80);
    if (normalizedDisplayName) {
      options.data = { display_name: normalizedDisplayName };
    }
    if (emailRedirectTo) {
      options.emailRedirectTo = String(emailRedirectTo);
    }
    const { data, error } = await ensureClient().auth.signUp({
      email: cleanEmail(email),
      password: String(password || ""),
      ...(Object.keys(options).length ? { options } : {}),
    });
    if (error) {
      const failure = authFailure(error, "注册失败，请稍后再试。");
      publish({ status: AUTH_STATUS.anonymous, error: failure });
      throw failure;
    }
    applySession(data?.session || null);
    return {
      user: data?.user || null,
      session: data?.session || null,
      emailVerificationRequired: !data?.session,
    };
  }

  async function signIn({ email, password } = {}) {
    requireConfiguration();
    await initialize();
    publish({ status: AUTH_STATUS.authenticating, error: null });
    const { data, error } = await ensureClient().auth.signInWithPassword({
      email: cleanEmail(email),
      password: String(password || ""),
    });
    if (error || !data?.session) {
      const failure = authFailure(
        error || { code: "invalid_session" },
        "登录失败，请检查邮箱和密码。",
      );
      publish({ status: AUTH_STATUS.anonymous, error: failure });
      throw failure;
    }
    applySession(data.session);
    return { user: data.user || data.session.user, session: data.session };
  }

  async function resendVerification({ email, emailRedirectTo } = {}) {
    requireConfiguration();
    await initialize();
    const options = emailRedirectTo
      ? { emailRedirectTo: String(emailRedirectTo) }
      : undefined;
    const { error } = await ensureClient().auth.resend({
      type: "signup",
      email: cleanEmail(email),
      ...(options ? { options } : {}),
    });
    if (error) {
      throw authFailure(error, "验证邮件发送失败，请稍后再试。");
    }
  }

  async function requestPasswordReset({ email, redirectTo } = {}) {
    requireConfiguration();
    await initialize();
    const options = redirectTo
      ? { redirectTo: String(redirectTo) }
      : undefined;
    const { error } = await ensureClient().auth.resetPasswordForEmail(
      cleanEmail(email),
      options,
    );
    if (error) {
      throw authFailure(error, "密码重置邮件发送失败，请稍后再试。");
    }
  }

  async function updatePassword({ password } = {}) {
    requireConfiguration();
    await initialize();
    if (!session?.user?.id || !passwordRecovery) {
      throw new AuthSessionError("密码重置链接已失效，请重新申请。", {
        code: "password_recovery_required",
        status: 401,
      });
    }
    const { data, error } = await ensureClient().auth.updateUser({
      password: String(password || ""),
    });
    if (error) {
      throw authFailure(error, "新密码保存失败，请重新申请重置邮件。");
    }
    passwordRecovery = false;
    applySession(session, AUTH_STATUS.authenticated);
    return { user: data?.user || session.user };
  }

  async function signOut() {
    if (!configured(normalizedUrl, normalizedKey)) {
      passwordRecovery = false;
      applySession(null);
      return;
    }
    await initialize();
    const { error } = await ensureClient().auth.signOut({ scope: "local" });
    if (error) {
      throw authFailure(error, "退出登录失败，请稍后再试。");
    }
    passwordRecovery = false;
    applySession(null);
  }

  async function getRequestContext() {
    if (!configured(normalizedUrl, normalizedKey)) return {};
    await initialize();
    if (!session?.access_token) return {};
    return {
      accessToken: session.access_token,
      companionId: readCompanionId(
        persistentStorage,
        session.user?.id,
      ),
    };
  }

  function setActiveCompanionId(companionId) {
    const normalized = String(companionId || "").trim();
    if (!UUID_PATTERN.test(normalized)) {
      throw new AuthSessionError("伴侣编号格式不正确。", {
        code: "invalid_companion_id",
      });
    }
    if (!session?.user?.id) {
      throw new AuthSessionError("请先登录后再切换 AI 伴侣。", {
        code: "authentication_required",
        status: 401,
      });
    }
    storeCompanionId(persistentStorage, session.user.id, normalized);
    publish({ activeCompanionId: normalized });
    return normalized;
  }

  function captureCompanionFromResponse(response) {
    const companionId = String(
      response?.headers?.get?.("X-DengTa-Companion-Id") || "",
    ).trim();
    if (!session?.user?.id || !UUID_PATTERN.test(companionId)) return "";
    storeCompanionId(persistentStorage, session.user.id, companionId);
    if (snapshot.activeCompanionId !== companionId) {
      publish({ activeCompanionId: companionId });
    }
    return companionId;
  }

  async function invalidateSession(message = "登录状态已经失效，请重新登录。") {
    if (client) {
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    }
    passwordRecovery = false;
    session = null;
    publish({
      status: AUTH_STATUS.expired,
      user: null,
      activeCompanionId: "",
      error: new AuthSessionError(message, {
        code: "invalid_session",
        status: 401,
      }),
    });
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot);
    return () => listeners.delete(listener);
  }

  function destroy() {
    authSubscription?.unsubscribe?.();
    authSubscription = null;
    listeners.clear();
  }

  return Object.freeze({
    initialize,
    signUp,
    signIn,
    signOut,
    resendVerification,
    requestPasswordReset,
    updatePassword,
    getRequestContext,
    setActiveCompanionId,
    captureCompanionFromResponse,
    invalidateSession,
    subscribe,
    destroy,
    getSnapshot: () => snapshot,
    isConfigured: () => configured(normalizedUrl, normalizedKey),
  });
}

export const authSession = createAuthSessionManager();
