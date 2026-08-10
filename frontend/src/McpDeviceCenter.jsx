import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";

const EMPTY_DRAFT = {
  name: "",
  endpoint: "",
  auth_type: "none",
  auth_header: "X-API-Key",
  credential: "",
  protocol_version: "2025-03-26",
};

async function mcpRequest(path, { method = "GET", body } = {}) {
  try {
    return await apiRequest(path, {
      method,
      headers: { Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      error?.message || "无法连接 DengTa 后端，请稍后再试。",
      { cause: error },
    );
  }
}

function policyLabel(value) {
  return value === "auto" ? "允许 AI 自动执行" : "禁止自动执行（默认）";
}

export default function McpDeviceCenter() {
  const [status, setStatus] = useState({ checking: true });
  const [connections, setConnections] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [discovery, setDiscovery] = useState(null);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    mcpRequest("/api/mcp/connections/status")
      .then((data) => setStatus({ ...data, checking: false }))
      .catch((error) => setStatus({ checking: false, available: false, message: error.message }));
    mcpRequest("/api/mcp/connections/manage")
      .then((data) => setConnections(data.connections || []))
      .catch((error) => setFeedback(error.message))
      .finally(() => setLoaded(true));
  }, []);

  const enabledTools = useMemo(
    () => connections.reduce(
      (total, connection) => total + Object.values(connection.tool_policies || {}).filter((value) => value === "auto").length,
      0,
    ),
    [connections],
  );

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDiscovery(null);
  }

  async function discover() {
    setBusy("discover");
    setFeedback("");
    try {
      const data = await mcpRequest("/api/mcp/connections/manage/discover", {
        method: "POST",
        body: draft,
      });
      setDiscovery(data);
      setFeedback(`连接成功，发现 ${data.tools?.length || 0} 个工具。`);
    } catch (error) {
      setDiscovery(null);
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function createConnection(event) {
    event.preventDefault();
    setBusy("create");
    setFeedback("");
    try {
      const data = await mcpRequest("/api/mcp/connections/manage", {
        method: "POST",
        body: draft,
      });
      setConnections((current) => [...current, data.connection]);
      setDraft(EMPTY_DRAFT);
      setDiscovery(null);
      setFeedback("连接已安全保存。所有工具仍默认禁止，请在下方逐项授权。 ");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  function editConnection(id, transform) {
    setConnections((current) => current.map((item) => (item.id === id ? transform(item) : item)));
  }

  async function saveConnection(connection) {
    setBusy(`save-${connection.id}`);
    setFeedback("");
    try {
      const data = await mcpRequest(`/api/mcp/connections/manage/${connection.id}`, {
        method: "PUT",
        body: {
          name: connection.name,
          enabled: connection.enabled,
          auth_type: connection.auth_type,
          auth_header: connection.auth_header,
          protocol_version: connection.protocol_version,
          tool_policies: connection.tool_policies,
          ...(connection.credential ? { credential: connection.credential } : {}),
        },
      });
      editConnection(connection.id, () => data.connection);
      setFeedback("设备权限已经保存。之后只有标为“允许自动执行”的工具会交给模型选择。 ");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function testConnection(connection) {
    setBusy(`test-${connection.id}`);
    setFeedback("");
    try {
      const data = await mcpRequest(`/api/mcp/connections/manage/${connection.id}/test`, {
        method: "POST",
      });
      editConnection(connection.id, () => data.connection);
      setFeedback(`测试成功，当前发现 ${data.connection.discovered_tools?.length || 0} 个工具。`);
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function removeConnection(connection) {
    if (!window.confirm(`删除“${connection.name}”的 MCP 连接和加密凭据？`)) return;
    setBusy(`delete-${connection.id}`);
    setFeedback("");
    try {
      await mcpRequest(`/api/mcp/connections/manage/${connection.id}`, {
        method: "DELETE",
      });
      setConnections((current) => current.filter((item) => item.id !== connection.id));
      setFeedback("连接和服务器保存的加密凭据已删除。 ");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="settings-card mcp-device-center">
      <div className="mcp-device-heading">
        <div>
          <h3>MCP 设备中心</h3>
          <p className="card-hint">
            接入空调、灯、Home Assistant 或其他 MCP 服务。模型会根据对话选择你明确授权的工具；这是一套可核验的工具调用机制，不是意识。
          </p>
        </div>
        <span className={`status-chip ${status.available ? "online" : "pending"}`}>
          {status.checking ? "检查中" : status.available ? `${status.connections || 0} 个连接` : "待配置"}
        </span>
      </div>

      <div className="mcp-safety-note">
        <strong>默认零权限</strong>
        <p>新连接的所有工具均为“禁止自动执行”。你必须逐项改成允许并启用连接，聊天模型才看得到它。设备凭据只在后端加密保存，不会回传页面。</p>
      </div>

      {!status.checking && !status.configured && (
        <div className="mcp-setup-required">
          <strong>无需授权的 MCP 可以直接添加</strong>
          <p>只有选择 Bearer 或 API Key 时才需要服务器加密密钥；Token 绝不会明文保存。添加 MCP 时不需要再输入管理口令。</p>
        </div>
      )}

      {feedback && <div className="mcp-feedback" role="status">{feedback}</div>}

      {!loaded ? (
        <div className="mcp-empty">正在读取 MCP 连接…</div>
      ) : (
        <>
          <form className="mcp-connection-form" onSubmit={createConnection}>
            <h4>添加一个 MCP 连接</h4>
            <div className="mcp-form-grid">
              <label>
                显示名称
                <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="例如：家里的空调" />
              </label>
              <label>
                协议版本
                <select value={draft.protocol_version} onChange={(event) => updateDraft("protocol_version", event.target.value)}>
                  <option value="2025-03-26">2025-03-26（推荐）</option>
                  <option value="2024-11-05">2024-11-05（兼容旧服务）</option>
                </select>
              </label>
              <label className="full-width">
                完整 MCP 地址
                <input value={draft.endpoint} onChange={(event) => updateDraft("endpoint", event.target.value)} placeholder="例如：https://你的-home-assistant.example.com/api/mcp" />
                <small>必须填写完整 HTTPS 端点，不要只填网站首页；云端不能访问 192.168.x.x 或 localhost。</small>
              </label>
              <label>
                授权方式
                <select value={draft.auth_type} onChange={(event) => updateDraft("auth_type", event.target.value)}>
                  <option value="none">不需要授权（默认）</option>
                  <option value="bearer">Bearer 访问令牌</option>
                  <option value="custom_header">自定义请求头</option>
                </select>
              </label>
              {draft.auth_type === "custom_header" && (
                <label>
                  请求头名称
                  <input value={draft.auth_header} onChange={(event) => updateDraft("auth_header", event.target.value)} placeholder="X-API-Key" />
                </label>
              )}
              {draft.auth_type !== "none" && (
                <label className="full-width">
                  访问令牌 / API Key
                  <input type="password" autoComplete="off" value={draft.credential} onChange={(event) => updateDraft("credential", event.target.value)} placeholder="只会发送给 DengTa 后端并加密保存" />
                </label>
              )}
            </div>
            <div className="mcp-form-actions">
              <button type="button" className="secondary-button" onClick={discover} disabled={Boolean(busy) || !draft.endpoint.trim()}>
                {busy === "discover" ? "连接中" : "测试并读取工具"}
              </button>
              <button className="primary-button" disabled={Boolean(busy) || !draft.name.trim() || !draft.endpoint.trim()}>
                {busy === "create" ? "保存中" : "安全保存连接"}
              </button>
            </div>
            {discovery && (
              <div className="mcp-discovery-result">
                <strong>{discovery.server_name || "MCP 服务"} 已响应</strong>
                <span>{(discovery.tools || []).map((tool) => tool.name).join("、") || "没有公开工具"}</span>
              </div>
            )}
          </form>

          <div className="mcp-connection-list">
            <div className="mcp-list-heading">
              <h4>已保存连接</h4>
              <span>{enabledTools} 个工具允许自动执行</span>
            </div>
            {connections.length === 0 ? (
              <div className="mcp-empty">还没有设备。先在上面测试并保存一个连接。</div>
            ) : connections.map((connection) => (
              <article className="mcp-connection-card" key={connection.id}>
                <div className="mcp-connection-title">
                  <div>
                    <strong>{connection.name}</strong>
                    <small>{connection.endpoint}</small>
                  </div>
                  <span className={`status-chip ${connection.last_status === "connected" ? "online" : "pending"}`}>
                    {connection.last_status === "connected" ? "已连接" : "需测试"}
                  </span>
                </div>
                <label className="mcp-enable-toggle">
                  <input type="checkbox" checked={connection.enabled === true} onChange={(event) => editConnection(connection.id, (current) => ({ ...current, enabled: event.target.checked }))} />
                  <span><strong>启用此连接</strong><small>关闭后，聊天模型看不到这里的任何工具</small></span>
                </label>
                {connection.auth_type !== "none" && (
                  <label className="mcp-credential-update">
                    更新访问令牌（可留空）
                    <input
                      type="password"
                      autoComplete="off"
                      value={connection.credential || ""}
                      onChange={(event) => editConnection(connection.id, (current) => ({ ...current, credential: event.target.value }))}
                      placeholder={connection.auth_configured ? "已加密保存；只在轮换密钥时填写新值" : "请填写访问令牌"}
                    />
                  </label>
                )}
                <div className="mcp-tool-list">
                  {(connection.discovered_tools || []).map((tool) => (
                    <label key={tool.name}>
                      <span><strong>{tool.name}</strong><small>{tool.description || "服务没有提供说明"}</small></span>
                      <select
                        aria-label={`${tool.name} 的自动执行权限`}
                        value={connection.tool_policies?.[tool.name] || "disabled"}
                        onChange={(event) => editConnection(connection.id, (current) => ({
                          ...current,
                          tool_policies: { ...current.tool_policies, [tool.name]: event.target.value },
                        }))}
                      >
                        <option value="disabled">{policyLabel("disabled")}</option>
                        <option value="auto">{policyLabel("auto")}</option>
                      </select>
                    </label>
                  ))}
                </div>
                <div className="mcp-card-actions">
                  <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => testConnection(connection)}>
                    {busy === `test-${connection.id}` ? "测试中" : "重新测试"}
                  </button>
                  <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => saveConnection(connection)}>
                    {busy === `save-${connection.id}` ? "保存中" : "保存权限"}
                  </button>
                  <button type="button" className="danger-outline-button" disabled={Boolean(busy)} onClick={() => removeConnection(connection)}>
                    删除连接
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <details className="mcp-tutorial">
        <summary>填写教程：空调、Home Assistant 和其他 MCP</summary>
        <div>
          <h4>最省事的空调接法：Home Assistant</h4>
          <ol>
            <li>先让空调接入 Home Assistant，并只公开你愿意让 AI 控制的实体。</li>
            <li>在 Home Assistant 中添加“Model Context Protocol Server”集成。</li>
            <li>在个人资料页打开“安全”，创建长期访问令牌；复制后填到上面的访问令牌。</li>
            <li>完整地址通常为 <code>https://你的公开域名/api/mcp</code>。如果只有 <code>http://192.168…</code>，Render 看不到它，需要先用 Home Assistant Cloud 或你信任的 HTTPS 隧道公开。</li>
            <li>点“测试并读取工具”，确认工具名后保存。最后只把调温等确实需要的工具改成“允许 AI 自动执行”。</li>
          </ol>
          <h4>市面上的其他 MCP</h4>
          <p>如果商家给你的是一个 HTTPS URL 和 Token，通常可以直接填。每家端点路径、授权方式和工具名可能不同，并不存在所有设备共用的一条固定路径。为控制模型请求大小，每轮最多加载 32 个已授权工具。</p>
          <p>如果给你的是 JSON 里的 <code>command</code>、<code>args</code> 或本地程序，那是 stdio MCP，Render 不能直接运行你电脑上的命令；需要商家提供远程 Streamable HTTP 地址，或先部署一个 HTTPS MCP 网关。</p>
          <p>如果服务只支持网页登录 OAuth，目前这个自定义窗口不会代替你登录；请优先使用服务商提供的访问令牌。OAuth 配对可作为后续升级。</p>
        </div>
      </details>
    </div>
  );
}
