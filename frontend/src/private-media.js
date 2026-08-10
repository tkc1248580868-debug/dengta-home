const PRIVATE_MEDIA_PATH =
  /^\/(?:(?:api\/v2\/(?:attachments|moments)|attachments)(?:\/|$)|api\/v2\/creative\/artworks\/[^/?]+\/image(?:\?|$))/;

export function privateMediaRequestPath(value, apiBaseUrl) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (PRIVATE_MEDIA_PATH.test(source)) return source;

  try {
    const mediaUrl = new URL(source);
    const apiUrl = new URL(String(apiBaseUrl || ""));
    if (mediaUrl.origin !== apiUrl.origin) return "";

    const basePath = apiUrl.pathname.replace(/\/$/, "");
    const path = `${mediaUrl.pathname}${mediaUrl.search}`;
    if (basePath && !path.startsWith(`${basePath}/`)) return "";
    const relativePath = basePath ? path.slice(basePath.length) : path;
    return PRIVATE_MEDIA_PATH.test(relativePath) ? relativePath : "";
  } catch {
    return "";
  }
}

export function isPrivateMediaUrl(value, apiBaseUrl) {
  return Boolean(privateMediaRequestPath(value, apiBaseUrl));
}
