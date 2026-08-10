import { useEffect, useState } from "react";
import { API_BASE_URL, apiFetch } from "./api";
import { privateMediaRequestPath } from "./private-media";

export function usePrivateMediaSource(source) {
  const value = String(source || "").trim();
  const requestPath = privateMediaRequestPath(value, API_BASE_URL);
  const [loaded, setLoaded] = useState({
    source: "",
    url: "",
    error: "",
  });

  useEffect(() => {
    if (!requestPath) return undefined;

    let active = true;
    let objectUrl = "";
    apiFetch(requestPath, { retry: false })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.message || "媒体暂时无法读取。");
        }
        const blob = await response.blob();
        if (!blob.size) throw new Error("媒体内容为空。");
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setLoaded({ source: value, url: objectUrl, error: "" });
        }
      })
      .catch((error) => {
        if (active) {
          setLoaded({
            source: value,
            url: "",
            error: error?.message || "媒体暂时无法读取。",
          });
        }
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requestPath, value]);

  if (!requestPath) {
    return { url: value, loading: false, error: "" };
  }
  if (loaded.source !== value) {
    return { url: "", loading: true, error: "" };
  }
  return {
    url: loaded.url,
    loading: false,
    error: loaded.error,
  };
}
