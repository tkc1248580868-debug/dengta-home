import { useEffect, useState } from "react";
import { apiRequest } from "./api";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "dynamic", label: "动态", type: "dynamic" },
  { key: "permanent", label: "永久", type: "permanent" },
  { key: "archived", label: "归档", type: "archived" },
  { key: "pinned", label: "已固定", state: "pinned" },
];

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function typeLabel(type) {
  const labels = {
    dynamic: "动态",
    permanent: "永久",
    archived: "归档",
    archive: "归档",
  };
  return labels[String(type || "").toLowerCase()] || type || "记忆";
}

export default function OmbreMemories() {
  const [connection, setConnection] = useState(null);
  const [mcpConnection, setMcpConnection] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [semanticSearch, setSemanticSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadItems(nextFilter = filter, query = activeQuery) {
    setLoading(true);
    setError("");
    try {
      let data;
      if (query) {
        data = await apiRequest(
          `/api/ombre/search?q=${encodeURIComponent(query)}`,
        );
      } else {
        const selectedFilter =
          FILTERS.find((item) => item.key === nextFilter) || FILTERS[0];
        const params = new URLSearchParams();
        if (selectedFilter.type) params.set("type", selectedFilter.type);
        if (selectedFilter.state) params.set("state", selectedFilter.state);
        const suffix = params.toString() ? `?${params.toString()}` : "";
        data = await apiRequest(`/api/ombre/buckets${suffix}`);
      }
      setItems(data.items || []);
      setSemanticSearch(data.semanticSearch || "");
    } catch (loadError) {
      setItems([]);
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadConnection() {
      setLoading(true);
      try {
        const config = await apiRequest("/api/ombre/config");
        if (cancelled) return;
        const mcpStatus = await apiRequest("/api/ombre/mcp/status").catch(
          (mcpError) => ({
            ...(config.mcp || {}),
            available: false,
            message: mcpError.message,
            tools: [],
          }),
        );
        if (cancelled) return;
        setMcpConnection({ ...(config.mcp || {}), ...mcpStatus });
        if (!config.configured) {
          setConnection({
            ...config,
            available: false,
            total: 0,
            message: "尚未连接记忆服务器",
          });
          setLoading(false);
          return;
        }
        const status = await apiRequest("/api/ombre/status");
        if (cancelled) return;
        setConnection(status);
        const memoryData = await apiRequest("/api/ombre/buckets");
        if (cancelled) return;
        setItems(memoryData.items || []);
        setSemanticSearch(memoryData.semanticSearch || "");
        setLoading(false);
      } catch (connectionError) {
        if (!cancelled) {
          setConnection((current) => ({
            ...(current || {}),
            configured: true,
            available: false,
            total: 0,
            message: connectionError.message,
          }));
          setLoading(false);
        }
      }
    }
    loadConnection();
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectFilter(nextFilter) {
    setFilter(nextFilter);
    setSearch("");
    setActiveQuery("");
    if (connection?.available) await loadItems(nextFilter, "");
  }

  async function submitSearch(event) {
    event.preventDefault();
    const query = search.trim();
    setActiveQuery(query);
    if (connection?.available) await loadItems(filter, query);
  }

  async function openDetail(item) {
    setDetailLoading(true);
    setSelected(item);
    try {
      const detail = await apiRequest(
        `/api/ombre/buckets/${encodeURIComponent(item.id)}`,
      );
      setSelected(detail);
    } catch (detailError) {
      setError(detailError.message);
    } finally {
      setDetailLoading(false);
    }
  }

  const statusClass = connection?.available
    ? "connected"
    : connection?.configured
      ? "unavailable"
      : "unconfigured";
  const mcpStatusClass = mcpConnection?.available
    ? "connected"
    : mcpConnection?.configured
      ? "unavailable"
      : mcpConnection
        ? "unconfigured"
        : "checking";
  const mcpTools = Array.isArray(mcpConnection?.tools)
    ? mcpConnection.tools.slice(0, 6)
    : [];

  return (
    <section className="ombre-memory-section" aria-labelledby="ombre-title">
      <div className="memory-source-heading">
        <div>
          <span className="eyebrow">OMBRE BRAIN</span>
          <h3 id="ombre-title">外部记忆库</h3>
        </div>
        <div className={`ombre-status ${statusClass}`}>
          <span aria-hidden="true" />
          {connection?.available
            ? `${connection.total || 0} 条记忆`
            : connection?.configured
              ? "连接不可用"
              : "未连接服务器"}
        </div>
      </div>

      <div className={`ombre-mcp-strip ${mcpStatusClass}`}>
        <span className="ombre-mcp-dot" aria-hidden="true" />
        <div>
          <strong>MCP 记忆协议</strong>
          <small>
            {mcpConnection?.available
              ? `已握手${mcpTools.length ? ` · ${mcpTools.join(" / ")}` : ""}`
              : mcpConnection?.configured
                ? mcpConnection.message || "服务器已填写，但握手暂时失败"
                : mcpConnection
                  ? "客户端已准备，等待 OMBRE_BRAIN_URL"
                  : "正在检查 MCP 客户端…"}
          </small>
        </div>
      </div>

      {!connection?.configured ? (
        <div className="ombre-empty-state">
          <strong>服务器接口已经准备好</strong>
          <p>购买任意 Ombre 服务器后即可连接，现有功能不受影响。</p>
          <code>OMBRE_BRAIN_URL</code>
        </div>
      ) : !connection?.available ? (
        <div className="ombre-empty-state error-state">
          <strong>暂时无法读取外部记忆</strong>
          <p>{connection?.message || "请稍后重试。"}</p>
        </div>
      ) : (
        <>
          <form className="ombre-toolbar" onSubmit={submitSearch}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索外部记忆"
              aria-label="搜索外部记忆"
            />
            <button type="submit">搜索</button>
          </form>
          <div className="ombre-filters" aria-label="记忆筛选">
            {FILTERS.map((item) => (
              <button
                type="button"
                className={filter === item.key && !activeQuery ? "active" : ""}
                key={item.key}
                onClick={() => selectFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {activeQuery && (
            <div className="ombre-search-summary">
              <span>“{activeQuery}” · {items.length} 条</span>
              {semanticSearch && semanticSearch !== "enabled" && (
                <span>语义检索：{semanticSearch}</span>
              )}
            </div>
          )}
          {error && <div className="ombre-inline-error">{error}</div>}
          <div className="ombre-memory-list">
            {loading ? (
              <div className="ombre-list-placeholder">正在读取记忆…</div>
            ) : items.length === 0 ? (
              <div className="ombre-list-placeholder">这里还没有记忆。</div>
            ) : (
              items.map((item) => (
                <button
                  type="button"
                  className="ombre-memory-item"
                  key={item.id}
                  onClick={() => openDetail(item)}
                >
                  <span className="ombre-item-topline">
                    <strong>{item.name}</strong>
                    <span>{typeLabel(item.type)}</span>
                  </span>
                  <span className="ombre-item-preview">
                    {item.contentPreview || "暂无预览"}
                  </span>
                  <span className="ombre-item-meta">
                    <span>重要度 {item.importance ?? 5}</span>
                    <span>{formatDate(item.lastActiveAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {selected && (
        <div className="ombre-detail-backdrop" onMouseDown={() => setSelected(null)}>
          <article
            className="ombre-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ombre-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="ombre-detail-close"
              aria-label="关闭记忆详情"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <span className="eyebrow">{typeLabel(selected.type)}</span>
            <h3 id="ombre-detail-title">{selected.name}</h3>
            {detailLoading ? (
              <p className="ombre-detail-loading">正在读取完整内容…</p>
            ) : (
              <>
                <div className="ombre-detail-meta">
                  <span>重要度 {selected.importance ?? 5}</span>
                  {selected.score !== null && selected.score !== undefined && (
                    <span>得分 {Number(selected.score).toFixed(3)}</span>
                  )}
                  <span>{formatDate(selected.lastActiveAt)}</span>
                </div>
                <div className="ombre-detail-content">
                  {selected.displayContent || selected.content || "暂无正文"}
                </div>
                {selected.tags?.length > 0 && (
                  <div className="ombre-detail-tags">
                    {selected.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                )}
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
