import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "./api";
import {
  DUEL_SKILLS,
  beginDuelRound,
  completeDuelRound,
  createDuelState,
  normalizeDuelState,
  skillAvailability,
  winnerLabel,
} from "./intimate-duel";

const STORAGE_KEY = "dengta_intimate_duel_v3";

function duelStorageKey(accountScope = "") {
  const scope = String(accountScope || "").trim();
  return scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY;
}

function readStoredDuel(names, accountScope) {
  try {
    const stored = localStorage.getItem(duelStorageKey(accountScope));
    return stored ? normalizeDuelState(JSON.parse(stored), names) : createDuelState(names);
  } catch {
    return createDuelState(names);
  }
}

function FighterCard({ fighter, tone }) {
  return (
    <article className={`duel-fighter-card ${tone}`}>
      <header>
        <span className="duel-avatar" aria-hidden="true">
          {fighter.name.slice(0, 1)}
        </span>
        <div>
          <strong>{fighter.name}</strong>
          <small>{fighter.combo > 1 ? `COMBO ×${fighter.combo}` : "READY"}</small>
        </div>
      </header>
      <div className="duel-meter-row stamina">
        <span>体力</span>
        <strong>{fighter.stamina}/100</strong>
        <div className="duel-meter" aria-label={`体力 ${fighter.stamina}`}>
          <span style={{ width: `${fighter.stamina}%` }} />
        </div>
      </div>
      <div className={`duel-meter-row pleasure${fighter.pleasure >= 78 ? " warning" : ""}`}>
        <span>快感</span>
        <strong>{fighter.pleasure}/100</strong>
        <div className="duel-meter" aria-label={`快感 ${fighter.pleasure}`}>
          <span style={{ width: `${fighter.pleasure}%` }} />
        </div>
      </div>
    </article>
  );
}

export default function IntimateDuel({
  aiName,
  userName,
  conversationId,
  accountScope = "",
}) {
  const names = useMemo(
    () => ({
      playerName: String(userName || "你").trim() || "你",
      companionName: String(aiName || "伴侣").trim() || "伴侣",
    }),
    [aiName, userName],
  );
  const [duel, setDuel] = useState(() => readStoredDuel(names, accountScope));
  const [isNarrating, setIsNarrating] = useState(false);
  const [notice, setNotice] = useState("");
  const logRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(duelStorageKey(accountScope), JSON.stringify(duel));
    } catch {
      // A full local store must not interrupt an active round.
    }
  }, [accountScope, duel]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [duel.logs, isNarrating]);

  function restart() {
    setDuel(createDuelState(names));
    setIsNarrating(false);
    setNotice("");
  }

  async function handleSkill(skill) {
    if (isNarrating || duel.status !== "active") return;
    let pending;
    try {
      pending = beginDuelRound(duel, skill.id);
      setDuel(pending.previewState);
      setIsNarrating(true);
      setNotice("");
      const turn = pending.turn;
      const data = await apiRequest("/api/v2/intimate-duel/narrate", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: conversationId || undefined,
          duel_id: pending.current.id,
          round: turn.round,
          player_name: turn.player.name,
          companion_name: turn.companion.name,
          player_skill: turn.playerSkill.id,
          companion_skill: null,
          available_companion_skills: turn.availableCompanionSkills,
          player: {
            stamina: turn.player.stamina,
            pleasure: turn.player.pleasure,
          },
          companion: {
            stamina: turn.companion.stamina,
            pleasure: turn.companion.pleasure,
          },
          player_combo: turn.playerCombo,
          companion_combo: turn.companionCombo,
          winner: turn.winner,
        }),
      });
      const result = completeDuelRound(pending, {
        companionSkillId: data?.companion_skill || null,
        reaction: data?.reaction || "",
        narration: data?.narration || "",
      });
      setDuel(result.state);
    } catch (error) {
      if (pending) {
        const fallback = completeDuelRound(pending);
        setDuel(fallback.state);
        setNotice(
          error.message ||
            `${names.companionName}这次没有连上模型，已按当前状态自行完成回应。`,
        );
      } else {
        setNotice(error.message);
      }
    } finally {
      setIsNarrating(false);
    }
  }

  return (
    <section className="feature-page intimate-duel" aria-label="成人双人回合对战">
      <header className="duel-stage-header">
        <div>
          <span>ADULT PRIVATE MATCH</span>
          <h2>{duel.status === "finished" ? winnerLabel(duel) : `ROUND ${duel.round}`}</h2>
        </div>
        <button type="button" className="duel-restart" onClick={restart}>
          {duel.status === "finished" ? "再来一局" : "重新开始"}
        </button>
      </header>

      <div className="duel-fighters">
        <FighterCard fighter={duel.player} tone="player" />
        <FighterCard fighter={duel.companion} tone="companion" />
      </div>

      <section ref={logRef} className="duel-log" aria-live="polite">
        {duel.logs.map((entry) => (
          <article key={entry.id} className={entry.kind}>
            <small>{entry.title}</small>
            {entry.reaction && (
              <div className="duel-visible-reaction">
                <small>{duel.companion.name}此刻的反应</small>
                <span>{entry.reaction}</span>
              </div>
            )}
            <p>{entry.text}</p>
          </article>
        ))}
        {isNarrating && (
          <div className="duel-narrating" role="status">
            <span aria-hidden="true" />
            {duel.companion.name}正在感受这一招并选择回应…
          </div>
        )}
      </section>

      {notice && (
        <div className="duel-notice" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button>
        </div>
      )}

      <section className="duel-skills" aria-label="选择招式">
        <h3>{duel.status === "finished" ? "本局已经结束" : "选择你的招式"}</h3>
        <div className="duel-skill-grid">
          {DUEL_SKILLS.map((skill) => {
            const availability = skillAvailability(duel.player, skill);
            const disabled = !availability.available || isNarrating || duel.status !== "active";
            return (
              <button
                type="button"
                key={skill.id}
                className={skill.kind}
                disabled={disabled}
                onClick={() => handleSkill(skill)}
              >
                <span className="duel-skill-heading">
                  <strong>{skill.name}</strong>
                  <em>
                    {availability.reason === "cooldown"
                      ? `${availability.cooldown} 回合`
                      : skill.kind === "recover"
                        ? "恢复"
                        : `-${skill.staminaCost} 体力`}
                  </em>
                </span>
                <small>{skill.description}</small>
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}
