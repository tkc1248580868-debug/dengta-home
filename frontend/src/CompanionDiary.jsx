import { useEffect, useState } from "react";
import { apiRequest } from "./api";
import FeatureAtmosphere from "./FeatureAtmosphere";

function formatDiaryDate(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSourceWindow(entry) {
  if (!entry?.source_window_start || !entry?.source_window_end) return "";
  return `${formatDiaryDate(entry.source_window_start)} 至 ${formatDiaryDate(
    entry.source_window_end,
  )}`;
}

export default function CompanionDiary({ aiName = "伴侣", onNotice }) {
  const [entries, setEntries] = useState([]);
  const [available, setAvailable] = useState(null);
  const [generation, setGeneration] = useState({
    state: "watching",
    message: "正在检查最近的对话。",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load({ silent = false } = {}) {
      try {
        const data = await apiRequest("/api/v2/diary");
        if (cancelled) return;
        setAvailable(data.available);
        setEntries(data.entries || []);
        setGeneration(
          data.generation || {
            state: "watching",
            message: "正在等待新的对话。",
          },
        );
      } catch (error) {
        if (!cancelled && !silent) onNotice?.(error.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    }, 20 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onNotice]);

  return (
    <section className="feature-page companion-diary-page">
      <FeatureAtmosphere kind="diary" />
      <div
        className={`diary-generation-state state-${generation.state || "watching"}`}
        role="status"
      >
        <img src="/app-icon.svg" alt="" />
        <div>
          <strong>
            {generation.state === "writing"
              ? `${aiName} 正在写`
              : "记忆手记自动更新"}
          </strong>
          <span>{generation.message}</span>
        </div>
      </div>

      {available === false ? (
        <div className="diary-empty">
          <h3>还差一次数据库升级</h3>
          <p>
            页面和生成逻辑已经就绪，但服务器需要执行
            `009_companion_diary.sql` 后才能保存日记。
          </p>
        </div>
      ) : loading ? (
        <div className="diary-empty">正在读取我们的记忆手记…</div>
      ) : entries.length === 0 ? (
        <div className="diary-empty">
          <h3>第一页还留着空白</h3>
          <p>
            再自然地聊几轮。达到双向消息数量后，{aiName}
            会自己写下第一篇，不会用模板故事填满这里。
          </p>
        </div>
      ) : (
        <div className="diary-entry-list">
          {entries.map((entry, index) => (
            <article className="diary-entry" key={entry.id}>
              <div className="diary-entry-index" aria-hidden="true">
                {String(entries.length - index).padStart(2, "0")}
              </div>
              <header>
                <div>
                  <time>{formatDiaryDate(entry.created_at)}</time>
                  <h3>{entry.title}</h3>
                </div>
                {entry.mood && <span>{entry.mood}</span>}
              </header>
              <p>{entry.content}</p>
              <footer>
                <span>
                  依据 {entry.source_message_count || 0} 条真实消息
                </span>
                <small>{formatSourceWindow(entry)}</small>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
