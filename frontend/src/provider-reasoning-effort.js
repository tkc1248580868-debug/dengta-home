export const REASONING_EFFORT_OPTIONS = Object.freeze([
  { value: "", label: "由服务商默认决定" },
  { value: "none", label: "none · 不启用额外推理" },
  { value: "low", label: "low · 较低" },
  { value: "medium", label: "medium · 中等" },
  { value: "high", label: "high · 较高" },
  { value: "xhigh", label: "xhigh · 极高" },
  { value: "max", label: "max · 最高" },
]);

export function reasoningProtocolForProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized === "openai-responses") return "openai-responses";
  if (["custom", "openai-compatible", "openai-chat"].includes(normalized)) {
    return "openai-chat";
  }
  return normalized;
}

export function reasoningEffortOptions(provider) {
  const protocol = reasoningProtocolForProvider(provider);
  if (protocol === "openai-responses") return REASONING_EFFORT_OPTIONS;
  if (protocol === "openai-chat") return REASONING_EFFORT_OPTIONS.slice(0, 2);
  return REASONING_EFFORT_OPTIONS.slice(0, 1);
}

export function reasoningEffortForProvider(provider, value) {
  const effort = String(value || "").trim().toLowerCase();
  return reasoningEffortOptions(provider).some((item) => item.value === effort)
    ? effort
    : "";
}
