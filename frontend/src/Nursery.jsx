import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "./api";

const SPEECH_ACTIONS = [
  { id: "talk", label: "说话" },
  { id: "teach", label: "教她" },
  { id: "feed", label: "喂语料" },
];

const CARE_ACTIONS = [
  { id: "soothe", label: "安抚", symbol: "♡" },
  { id: "diaper", label: "换尿布", symbol: "◇" },
  { id: "burp", label: "拍嗝", symbol: "○" },
  { id: "play", label: "玩一会", symbol: "✦" },
];

const STATE_ITEMS = [
  ["mood", "心情"],
  ["health", "健康"],
  ["nutrition", "饱足"],
  ["fatigue", "疲劳"],
  ["intimacy", "亲密"],
  ["digest_load", "消化负担"],
];

function clientActionId(kind) {
  const generated = globalThis.crypto?.randomUUID?.();
  return generated || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function StateMeter({ label, value, inverse = false }) {
  const amount = Math.min(100, Math.max(0, Number(value || 0)));
  return (
    <div className={`nursery-meter${inverse ? " is-inverse" : ""}`}>
      <span>
        <small>{label}</small>
        <strong>{Math.round(amount)}</strong>
      </span>
      <i aria-hidden="true">
        <b style={{ width: `${amount}%` }} />
      </i>
    </div>
  );
}

export default function Nursery({ aiName = "伴侣", onNotice }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [speechAction, setSpeechAction] = useState("talk");
  const [speechText, setSpeechText] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [portrait, setPortrait] = useState(null);
  const [portraitOpen, setPortraitOpen] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      try {
        const data = await apiRequest("/api/v2/nursery");
        if (!mountedRef.current) return;
        setSnapshot(data);
      } catch (error) {
        if (mountedRef.current && !silent) onNotice?.(error.message);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [onNotice],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (!cancelled && document.visibilityState === "visible") {
        void load({ silent: true });
      }
    }, 60 * 1000);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load]);

  const child = snapshot?.child || null;
  const latestUtterance = snapshot?.utterances?.[0] || null;
  const bonds = useMemo(
    () =>
      Object.fromEntries(
        (snapshot?.bonds || []).map((bond) => [bond.caregiver_kind, bond]),
      ),
    [snapshot?.bonds],
  );

  async function perform(label, request) {
    if (busy) return null;
    setBusy(label);
    try {
      const data = await request();
      setSnapshot(data);
      setPortrait(null);
      return data;
    } catch (error) {
      onNotice?.(error.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function createChild() {
    await perform("birth", () =>
      apiRequest("/api/v2/nursery/children", {
        method: "POST",
        body: JSON.stringify({ client_action_id: clientActionId("birth") }),
      }),
    );
  }

  async function sendSpeech(event) {
    event.preventDefault();
    const text = speechText.trim();
    if (!child || !text) return;
    const result = await perform("speech", () =>
      apiRequest(`/api/v2/nursery/children/${child.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: speechAction,
          text,
          client_action_id: clientActionId(speechAction),
        }),
      }),
    );
    if (result) setSpeechText("");
  }

  async function care(action) {
    if (!child) return;
    await perform(action, () =>
      apiRequest(`/api/v2/nursery/children/${child.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action,
          client_action_id: clientActionId(action),
        }),
      }),
    );
  }

  async function letCompanionCare() {
    if (!child) return;
    await perform("companion", () =>
      apiRequest(
        `/api/v2/nursery/children/${child.id}/companion-actions`,
        {
          method: "POST",
          body: JSON.stringify({
            client_action_id: clientActionId("companion"),
          }),
        },
      ),
    );
  }

  async function chooseName(event) {
    event.preventDefault();
    if (!child) return;
    const candidates = nameDraft
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!candidates.length) return;
    const result = await perform("name", () =>
      apiRequest(`/api/v2/nursery/children/${child.id}/name`, {
        method: "POST",
        body: JSON.stringify({
          candidates,
          client_action_id: clientActionId("name"),
        }),
      }),
    );
    if (result) setNameDraft("");
  }

  async function togglePortrait() {
    const nextOpen = !portraitOpen;
    setPortraitOpen(nextOpen);
    if (!nextOpen || portrait || !child) return;
    setBusy("portrait");
    try {
      const data = await apiRequest(
        `/api/v2/nursery/children/${child.id}/portrait`,
      );
      setPortrait(data.portrait || null);
    } catch (error) {
      onNotice?.(error.message);
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <section className="feature-page nursery-page is-loading">正在回家…</section>;
  }

  if (snapshot?.available === false) {
    return (
      <section className="feature-page nursery-page">
        <div className="nursery-empty-state">
          <strong>育儿房正在准备</strong>
          <span>{snapshot.message}</span>
        </div>
      </section>
    );
  }

  if (!child) {
    return (
      <section className="feature-page nursery-page">
        <div className="nursery-birth-scene">
          <span className="nursery-birth-mark" aria-hidden="true">✦</span>
          <h2>我们的小朋友</h2>
          <button type="button" disabled={Boolean(busy)} onClick={createChild}>
            {busy === "birth" ? "正在出生…" : "迎接她回家"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="feature-page nursery-page">
      <header className="nursery-hero">
        <div className="nursery-child-orbit" aria-hidden="true">
          <span>{child.name?.slice(0, 1) || "?"}</span>
        </div>
        <div>
          <small>{child.stage.label} · 第 {child.stage.age_days.toFixed(1)} 天</small>
          <h2>{child.display_name}</h2>
          <p>{latestUtterance ? `“${latestUtterance.text}”` : "“咿呀……”"}</p>
        </div>
        <span className="nursery-local-badge">LOCAL</span>
      </header>

      {!child.name && (
        <form className="nursery-name-form" onSubmit={chooseName}>
          <input
            value={nameDraft}
            maxLength={64}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="一个名字，或最多三个候选"
          />
          <button type="submit" disabled={busy === "name" || !nameDraft.trim()}>
            {busy === "name" ? "…" : "定名"}
          </button>
        </form>
      )}

      <div className="nursery-state-grid">
        {STATE_ITEMS.map(([key, label]) => (
          <StateMeter
            key={key}
            label={label}
            value={snapshot.state?.[key]}
            inverse={key === "fatigue" || key === "digest_load"}
          />
        ))}
      </div>

      <form className="nursery-speech-form" onSubmit={sendSpeech}>
        <div className="nursery-segments" role="group" aria-label="说话方式">
          {SPEECH_ACTIONS.map((action) => (
            <button
              type="button"
              key={action.id}
              className={speechAction === action.id ? "active" : ""}
              onClick={() => setSpeechAction(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="nursery-speech-composer">
          <textarea
            value={speechText}
            maxLength={1000}
            rows={3}
            onChange={(event) => setSpeechText(event.target.value)}
            placeholder="说给孩子听…"
          />
          <button type="submit" disabled={busy === "speech" || !speechText.trim()} aria-label="发送给孩子">
            {busy === "speech" ? "…" : "↑"}
          </button>
        </div>
      </form>

      <div className="nursery-care-grid">
        {CARE_ACTIONS.map((action) => (
          <button
            type="button"
            key={action.id}
            disabled={Boolean(busy)}
            onClick={() => care(action.id)}
          >
            <span aria-hidden="true">{action.symbol}</span>
            <small>{busy === action.id ? "进行中" : action.label}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="nursery-companion-action"
        disabled={Boolean(busy)}
        onClick={letCompanionCare}
      >
        <span>{aiName.slice(0, 1)}</span>
        <strong>{busy === "companion" ? `${aiName}正在陪她` : `让${aiName}陪她一会`}</strong>
      </button>

      <section className="nursery-bonds">
        {[
          ["user", "和我"],
          ["companion", `和${aiName}`],
        ].map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{Math.round(Number(bonds[key]?.attachment || 20))}</strong>
            <small>安心 {Math.round(Number(bonds[key]?.trust || 20))}</small>
          </div>
        ))}
      </section>

      <section className="nursery-album">
        <header>
          <h3>成长相册</h3>
          <span>{snapshot.milestones?.length || 0}</span>
        </header>
        <div>
          {(snapshot.milestones || []).slice(0, 12).map((milestone) => (
            <article key={milestone.id}>
              <time>{formatTime(milestone.created_at)}</time>
              <strong>{milestone.title}</strong>
              {milestone.note && <p>{milestone.note}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="nursery-portrait">
        <button type="button" onClick={togglePortrait} disabled={busy === "portrait"}>
          <span>成长画像</span>
          <strong>{portraitOpen ? "收起" : busy === "portrait" ? "读取中" : "查看"}</strong>
        </button>
        {portraitOpen && portrait && (
          <div>
            <span>学过 {portrait.language.learned_characters} 个字</span>
            <span>词汇 {portrait.language.unique_characters} 种</span>
            <span>回应 {portrait.language.utterances} 次</span>
            <span>里程碑 {portrait.milestones} 个</span>
          </div>
        )}
      </section>
    </section>
  );
}
