const HEALTH_PRESENTATIONS = Object.freeze({
  catalog_ok: {
    label: "模型目录可读取",
    summary: "模型目录可读取",
    detail: "已验证连接、凭据和模型目录；这不代表聊天生成请求一定成功。",
  },
  catalog_error: {
    label: "检查失败",
    summary: "模型目录检查失败",
    detail: "模型目录暂时无法读取。请检查接口配置、权限或额度后重新测试。",
  },
  expired: {
    label: "已到期",
    summary: "已到期，不参与路由",
    detail: "该接口已到期，不会参与后续聊天请求。",
  },
  untested: {
    label: "尚未检查",
    summary: "尚未检查模型目录",
    detail: "尚未执行供应商模型目录检查。",
  },
});

function displayText(value, maxLength) {
  const redacted = String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[已隐藏密钥]")
    .replace(/\b(?:gsk_|AIza|xai-)[A-Za-z0-9_-]{8,}\b/g, "[已隐藏密钥]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [已隐藏密钥]")
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[已隐藏密钥]",
    );
  const cleaned = Array.from(redacted)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, maxLength).join("");
}

function validCalendarParts(match) {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  if (
    !Number.isInteger(year)
    || year < 1
    || month < 1
    || month > 12
    || day < 1
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return false;
  }
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  const text = String(value).trim();
  const dateParts = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/,
  );
  if (!dateParts || !validCalendarParts(dateParts)) return null;
  const isBeijingLocalValue = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text);
  const date = new Date(
    isBeijingLocalValue
      ? `${text.length === 16 ? `${text}:00` : text}+08:00`
      : text,
  );
  return Number.isFinite(date.getTime()) ? date : null;
}

export function providerIsExpired(profile = {}, now = Date.now()) {
  const expiresAt = validDate(profile?.expires_at);
  if (expiresAt) return expiresAt.getTime() <= now;
  return profile?.health?.state === "expired";
}

export function providerIsRoutable(profile = {}, now = Date.now()) {
  return profile.enabled === true && !providerIsExpired(profile, now);
}

function legacyHealthState(profile, now) {
  if (providerIsExpired(profile, now)) return "expired";
  if (profile?.last_status === "connected") return "catalog_ok";
  if (profile?.last_status === "error") return "catalog_error";
  return "untested";
}

export function formatBeijingDateTime(value) {
  const date = validDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

export function beijingDateTimeInputValue(value) {
  return formatBeijingDateTime(value).replace(" ", "T");
}

export function beijingDateTimePayload(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const localMatch = text.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (localMatch) {
    const parsed = new Date(`${text.length === 16 ? `${text}:00` : text}+08:00`);
    if (
      Number.isFinite(parsed.getTime())
      && beijingDateTimeInputValue(parsed) === text.slice(0, 16)
    ) {
      return parsed.toISOString();
    }
    return null;
  }
  const parsed = validDate(text);
  return parsed ? parsed.toISOString() : null;
}

export function formatProviderCheckedAt(value) {
  const checkedAt = formatBeijingDateTime(value);
  if (!checkedAt) return "上次检查（北京时间）：尚无记录";
  return `上次检查（北京时间）：${checkedAt}`;
}

export function providerHealthView(profile = {}, now = Date.now()) {
  const serverHealth = profile?.health;
  const hasKnownServerState = Boolean(
    serverHealth
      && Object.hasOwn(HEALTH_PRESENTATIONS, serverHealth.state),
  );
  const expired = providerIsExpired(profile, now);
  const serverStateIsCurrent = hasKnownServerState
    && (serverHealth.state !== "expired" || expired);
  const state = expired
    ? "expired"
    : serverStateIsCurrent
      ? serverHealth.state
      : legacyHealthState(profile, now);
  const usesServerHealth = serverStateIsCurrent && state === serverHealth.state;
  const presentation = HEALTH_PRESENTATIONS[state];
  const checkedAt = validDate(
    serverStateIsCurrent
      ? serverHealth.checked_at || profile.last_checked_at
      : profile.last_checked_at,
  );

  return {
    state,
    label: presentation.label,
    summary: usesServerHealth
      ? displayText(serverHealth.summary, 120) || presentation.summary
      : presentation.summary,
    detail: usesServerHealth
      ? displayText(serverHealth.detail, 360) || presentation.detail
      : presentation.detail,
    checkedAtIso: checkedAt?.toISOString() || "",
    checkedAtLabel: formatProviderCheckedAt(checkedAt),
  };
}
