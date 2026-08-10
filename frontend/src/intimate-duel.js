const DUEL_STATE_VERSION = 3;
const MAX_LOG_ENTRIES = 36;

export const DUEL_SKILLS = Object.freeze([
  Object.freeze({
    id: "neck",
    name: "骑乘",
    description: "骑上去主动掌握起伏节奏",
    staminaCost: 8,
    pleasureDamage: 13,
    selfPleasure: 1,
    cooldown: 0,
    kind: "attack",
  }),
  Object.freeze({
    id: "whisper",
    name: "口交",
    description: "用嘴和舌头直接刺激对方",
    staminaCost: 10,
    pleasureDamage: 16,
    selfPleasure: 2,
    cooldown: 1,
    kind: "attack",
  }),
  Object.freeze({
    id: "waist",
    name: "夹紧",
    description: "收缩内壁绞紧，对双方都有刺激",
    staminaCost: 12,
    pleasureDamage: 19,
    selfPleasure: 5,
    cooldown: 1,
    kind: "attack",
  }),
  Object.freeze({
    id: "thigh",
    name: "挑逗",
    description: "用露骨语言和动作持续撩拨",
    staminaCost: 14,
    pleasureDamage: 22,
    selfPleasure: 3,
    cooldown: 2,
    kind: "attack",
  }),
  Object.freeze({
    id: "reverse",
    name: "Pegging",
    description: "反客为主的高伤害终结大招",
    staminaCost: 25,
    pleasureDamage: 34,
    selfPleasure: 7,
    cooldown: 4,
    kind: "ultimate",
  }),
  Object.freeze({
    id: "breathe",
    name: "喘口气",
    description: "恢复体力，并压低自己的快感",
    staminaCost: 0,
    pleasureDamage: 0,
    selfPleasure: 0,
    staminaRestore: 24,
    pleasureRelief: 18,
    cooldown: 2,
    kind: "recover",
  }),
]);

const SKILLS_BY_ID = new Map(DUEL_SKILLS.map((skill) => [skill.id, skill]));

export function clampDuelValue(value) {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

function emptyCooldowns() {
  return Object.fromEntries(DUEL_SKILLS.map((skill) => [skill.id, 0]));
}

function normalizeName(value, fallback) {
  return String(value || "").trim().slice(0, 32) || fallback;
}

function createFighter(name) {
  return {
    name,
    stamina: 100,
    pleasure: 0,
    combo: 0,
    lastSkillId: null,
    cooldowns: emptyCooldowns(),
  };
}

function createLogEntry({ id, round, title, text, reaction = "", kind = "round" }) {
  return {
    id,
    round,
    title,
    text,
    reaction: String(reaction || "").trim().slice(0, 500),
    kind,
    createdAt: new Date().toISOString(),
  };
}

export function createDuelState({ playerName = "你", companionName = "伴侣" } = {}) {
  const id = globalThis.crypto?.randomUUID?.() || `duel-${Date.now()}`;
  return {
    version: DUEL_STATE_VERSION,
    id,
    round: 1,
    status: "active",
    winner: null,
    player: createFighter(normalizeName(playerName, "你")),
    companion: createFighter(normalizeName(companionName, "伴侣")),
    logs: [
      createLogEntry({
        id: `${id}-start`,
        round: 0,
        title: "对战开始",
        text: "性爱格斗开始了。谁先高潮或先耗尽体力，谁就输掉这一局。",
        kind: "system",
      }),
    ],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCooldowns(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    DUEL_SKILLS.map((skill) => [
      skill.id,
      Math.min(9, Math.max(0, Math.round(Number(source[skill.id]) || 0))),
    ]),
  );
}

function normalizeFighter(value, fallbackName) {
  const source = value && typeof value === "object" ? value : {};
  return {
    name: normalizeName(source.name, fallbackName),
    stamina: clampDuelValue(source.stamina ?? 100),
    pleasure: clampDuelValue(source.pleasure ?? 0),
    combo: Math.min(9, Math.max(0, Math.round(Number(source.combo) || 0))),
    lastSkillId: SKILLS_BY_ID.has(source.lastSkillId)
      ? source.lastSkillId
      : null,
    cooldowns: normalizeCooldowns(source.cooldowns),
  };
}

export function normalizeDuelState(value, names = {}) {
  const fallback = createDuelState(names);
  if (!value || typeof value !== "object" || value.version !== DUEL_STATE_VERSION) {
    return fallback;
  }
  const status = ["active", "finished"].includes(value.status)
    ? value.status
    : "active";
  const winner = ["player", "companion", "draw", null].includes(value.winner)
    ? value.winner
    : null;
  const logs = Array.isArray(value.logs)
    ? value.logs
        .filter((item) => item && typeof item.text === "string")
        .slice(-MAX_LOG_ENTRIES)
        .map((item, index) => ({
          id: String(item.id || `${value.id || fallback.id}-log-${index}`),
          round: Math.max(0, Math.round(Number(item.round) || 0)),
          title: String(item.title || "回合记录").slice(0, 40),
          text: String(item.text).trim().slice(0, 1200),
          reaction: String(item.reaction || "").trim().slice(0, 500),
          kind: String(item.kind || "round").slice(0, 20),
          createdAt: String(item.createdAt || new Date().toISOString()),
        }))
    : fallback.logs;
  return {
    version: DUEL_STATE_VERSION,
    id: String(value.id || fallback.id),
    round: Math.min(999, Math.max(1, Math.round(Number(value.round) || 1))),
    status,
    winner: status === "finished" ? winner : null,
    player: normalizeFighter(value.player, normalizeName(names.playerName, "你")),
    companion: normalizeFighter(
      value.companion,
      normalizeName(names.companionName, "伴侣"),
    ),
    logs: logs.length > 0 ? logs : fallback.logs,
    updatedAt: String(value.updatedAt || new Date().toISOString()),
  };
}

export function skillAvailability(fighter, skill) {
  const cooldown = Math.max(0, Number(fighter?.cooldowns?.[skill.id]) || 0);
  if (cooldown > 0) return { available: false, reason: "cooldown", cooldown };
  if (Number(fighter?.stamina || 0) < skill.staminaCost) {
    return { available: false, reason: "stamina", cooldown: 0 };
  }
  if (
    skill.kind === "recover" &&
    Number(fighter?.stamina || 0) >= 100 &&
    Number(fighter?.pleasure || 0) <= 0
  ) {
    return { available: false, reason: "full", cooldown: 0 };
  }
  return { available: true, reason: null, cooldown: 0 };
}

function tickCooldowns(cooldowns) {
  return Object.fromEntries(
    DUEL_SKILLS.map((skill) => [
      skill.id,
      Math.max(0, Number(cooldowns?.[skill.id] || 0) - 1),
    ]),
  );
}

function applySkill(actorValue, targetValue, skill) {
  const continuesCombo =
    skill.kind !== "recover" &&
    actorValue.lastSkillId &&
    actorValue.lastSkillId !== skill.id;
  const combo = skill.kind === "recover" ? 0 : continuesCombo ? actorValue.combo + 1 : 1;
  const comboDamage = continuesCombo ? Math.min(8, combo * 2) : 0;
  const actor = {
    ...actorValue,
    stamina: clampDuelValue(
      actorValue.stamina - skill.staminaCost + (skill.staminaRestore || 0),
    ),
    pleasure: clampDuelValue(
      actorValue.pleasure + skill.selfPleasure - (skill.pleasureRelief || 0),
    ),
    cooldowns: {
      ...actorValue.cooldowns,
      [skill.id]: skill.cooldown + 1,
    },
    combo,
    lastSkillId: skill.id,
  };
  const target = {
    ...targetValue,
    pleasure: clampDuelValue(
      targetValue.pleasure + skill.pleasureDamage + comboDamage,
    ),
  };
  return { actor, target };
}

function outcomeAfterMove(actor, target, actorSide, targetSide) {
  const actorLost = actor.stamina <= 0 || actor.pleasure >= 100;
  const targetLost = target.stamina <= 0 || target.pleasure >= 100;
  if (actorLost && targetLost) return "draw";
  if (actorLost) return targetSide;
  if (targetLost) return actorSide;
  return null;
}

function availableSkillsFor(fighter) {
  return DUEL_SKILLS.filter((skill) => skillAvailability(fighter, skill).available);
}

export function chooseCompanionSkill(state, random = Math.random) {
  const fighter = state.companion;
  const available = availableSkillsFor(fighter);
  const recover = available.find((skill) => skill.kind === "recover");
  if (recover && (fighter.pleasure >= 68 || fighter.stamina <= 30)) {
    return recover;
  }
  const ultimate = available.find((skill) => skill.kind === "ultimate");
  if (ultimate && (state.player.pleasure >= 64 || state.player.stamina <= 30)) {
    return ultimate;
  }
  const attacks = available.filter((skill) => skill.kind !== "recover");
  if (attacks.length > 0) {
    const weighted = [...attacks, ...attacks.filter((skill) => skill.cooldown <= 1)];
    return weighted[Math.floor(Math.max(0, Math.min(0.999999, random())) * weighted.length)];
  }
  return recover || available[0] || DUEL_SKILLS.at(-1);
}

function playerOpeningText(player, companion, playerSkill) {
  const playerScenes = {
    neck: `${player.name}跨坐到${companion.name}身上，主动掌握起伏节奏。`,
    whisper: `${player.name}俯下身，用嘴唇、舌尖和呼吸直接刺激${companion.name}。`,
    waist: `${player.name}故意收紧动作，一阵阵绞住${companion.name}，不让她轻易抽身。`,
    thigh: `${player.name}贴着${companion.name}磨蹭，用动作和话语持续撩拨她。`,
    reverse: `${player.name}突然反客为主夺走主导，把${companion.name}压在身下发动 Pegging 攻势。`,
    breathe: `${player.name}暂时放慢动作调整呼吸，让自己稍微恢复。`,
  };
  return (
    playerScenes[playerSkill.id] ||
    `${player.name}对${companion.name}使出「${playerSkill.name}」。`
  );
}

function localRoundText(player, companion, playerSkill, companionSkill, outcome) {
  const opening = playerOpeningText(player, companion, playerSkill);
  const response = companionSkill
    ? `${companion.name}接住这一招后，自行选择「${companionSkill.name}」回应${player.name}。`
    : `${companion.name}还没来得及反击，这一局就已经分出了结果。`;
  if (!outcome) return `${opening}${response}`;
  return `${opening}${response} 数值越过临界点，本局结束。`;
}

export function beginDuelRound(value, playerSkillId) {
  const current = normalizeDuelState(value);
  if (current.status !== "active") {
    throw new Error("这一局已经结束，请先重新开始。");
  }
  const playerSkill = SKILLS_BY_ID.get(playerSkillId);
  if (!playerSkill) throw new Error("没有找到这个技能。");

  const playerAvailability = skillAvailability(current.player, playerSkill);
  if (!playerAvailability.available) {
    throw new Error(
      playerAvailability.reason === "cooldown"
        ? `技能还要等待 ${playerAvailability.cooldown} 回合。`
        : "当前体力不足以使用这个技能。",
    );
  }

  const { actor: player, target: companion } = applySkill(
    current.player,
    current.companion,
    playerSkill,
  );
  const winner = outcomeAfterMove(player, companion, "player", "companion");
  const availableCompanionSkills = winner
    ? []
    : availableSkillsFor(companion).map((skill) => skill.id);
  const eventId = `${current.id}-round-${current.round}-${Date.now()}`;
  const openingText = playerOpeningText(current.player, current.companion, playerSkill);
  return {
    current,
    player,
    companion,
    winner,
    turn: {
      id: eventId,
      round: current.round,
      playerSkill,
      playerCombo: player.combo,
      companionCombo: companion.combo,
      player: { name: current.player.name, stamina: player.stamina, pleasure: player.pleasure },
      companion: {
        name: current.companion.name,
        stamina: companion.stamina,
        pleasure: companion.pleasure,
      },
      availableCompanionSkills,
      winner,
      openingText,
    },
    previewState: {
      ...current,
      player,
      companion,
      logs: [
        ...current.logs,
        createLogEntry({
          id: eventId,
          round: current.round,
          title: `第 ${current.round} 回合`,
          text: openingText,
          kind: "pending",
        }),
      ].slice(-MAX_LOG_ENTRIES),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function completeDuelRound(pending, response = {}, random = Math.random) {
  if (!pending?.current || !pending?.turn) {
    throw new Error("这一回合的待处理状态已经失效。");
  }
  const { current, turn } = pending;
  let { player, companion, winner } = pending;
  let companionSkill = null;
  if (!winner) {
    const requested = SKILLS_BY_ID.get(String(response.companionSkillId || ""));
    const requestedAvailable =
      requested && turn.availableCompanionSkills.includes(requested.id);
    companionSkill = requestedAvailable
      ? requested
      : chooseCompanionSkill({ ...current, player, companion }, random);
    const result = applySkill(companion, player, companionSkill);
    companion = result.actor;
    player = result.target;
    winner = outcomeAfterMove(companion, player, "companion", "player");
  }

  player = { ...player, cooldowns: tickCooldowns(player.cooldowns) };
  companion = { ...companion, cooldowns: tickCooldowns(companion.cooldowns) };
  const event = {
    id: turn.id,
    round: current.round,
    playerSkill: turn.playerSkill,
    companionSkill,
    playerCombo: player.combo,
    companionCombo: companion.combo,
    winner,
    player: { stamina: player.stamina, pleasure: player.pleasure },
    companion: { stamina: companion.stamina, pleasure: companion.pleasure },
  };
  const narration = String(response.narration || "").trim().slice(0, 1200);
  const reaction = String(response.reaction || "").trim().slice(0, 500);
  const next = {
    ...current,
    round: winner ? current.round : current.round + 1,
    status: winner ? "finished" : "active",
    winner,
    player,
    companion,
    logs: [
      ...current.logs,
      createLogEntry({
        id: turn.id,
        round: current.round,
        title: winner ? "终局" : `第 ${current.round} 回合`,
        text:
          narration ||
          localRoundText(
            current.player,
            current.companion,
            turn.playerSkill,
            companionSkill,
            winner,
          ),
        reaction,
        kind: winner ? "result" : "round",
      }),
    ].slice(-MAX_LOG_ENTRIES),
    updatedAt: new Date().toISOString(),
  };
  return { state: next, event };
}

export function playDuelRound(value, playerSkillId, random = Math.random) {
  const pending = beginDuelRound(value, playerSkillId);
  const stateForChoice = {
    ...pending.current,
    player: pending.player,
    companion: pending.companion,
  };
  const companionSkill = pending.winner
    ? null
    : chooseCompanionSkill(stateForChoice, random);
  return completeDuelRound(
    pending,
    { companionSkillId: companionSkill?.id || null },
    random,
  );
}

export function applyDuelNarration(value, eventId, text) {
  const state = normalizeDuelState(value);
  const narration = String(text || "").trim().slice(0, 1200);
  if (!narration) return state;
  return {
    ...state,
    logs: state.logs.map((entry) =>
      entry.id === eventId ? { ...entry, text: narration } : entry,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function winnerLabel(state) {
  if (state.winner === "player") return `${state.player.name}赢了`;
  if (state.winner === "companion") return `${state.companion.name}赢了`;
  if (state.winner === "draw") return "这一局同时失守";
  return "对战进行中";
}
