import assert from "node:assert/strict";
import {
  HOT_ZONES,
  RECOVERY_ACTIONS,
  companionStatusForRequest,
  createDefaultCompanionStatus,
  createResetCompanionStatus,
  createDefaultCompanionInteractionStats,
  deriveLocalCompanionReactionState,
  localCompanionInteractionReaction,
  mergeCompanionStatus,
  normalizeCompanionInteractionStats,
  personalizeCompanionStatusText,
  readCompanionInteractionStats,
  readCompanionStatus,
  recordCompanionInteraction,
  saveCompanionInteractionStats,
  saveCompanionStatus,
} from "../src/companion-status.js";
import { enqueueCompanionInteraction } from "../src/companion-interaction.js";

const resetBlankStatus = createResetCompanionStatus();
assert.equal(resetBlankStatus.resetBlank, true);
assert.equal(resetBlankStatus.note, "");
assert.equal(companionStatusForRequest(resetBlankStatus).note, "");

const originalLocalStorage = globalThis.localStorage;
const localValues = new Map();
globalThis.localStorage = {
  getItem(key) {
    return localValues.has(key) ? localValues.get(key) : null;
  },
  setItem(key, value) {
    localValues.set(key, String(value));
  },
};
saveCompanionStatus({ mood: "账号甲" }, "account-a");
saveCompanionStatus({ mood: "账号乙" }, "account-b");
saveCompanionInteractionStats({ counts: { hand: 2 } }, "account-a");
saveCompanionInteractionStats({ counts: { hand: 7 } }, "account-b");
assert.equal(readCompanionStatus("account-a").mood, "账号甲");
assert.equal(readCompanionStatus("account-b").mood, "账号乙");
assert.equal(readCompanionInteractionStats("account-a").counts.hand, 2);
assert.equal(readCompanionInteractionStats("account-b").counts.hand, 7);
globalThis.localStorage = originalLocalStorage;

const handZone = HOT_ZONES.find((zone) => zone.id === "hand");
const shoulderZone = HOT_ZONES.find((zone) => zone.id === "shoulder");
assert.ok(handZone);
assert.ok(shoulderZone);
assert.deepEqual(
  RECOVERY_ACTIONS.map((action) => action.id),
  ["confide", "embrace", "wish"],
);
assert.ok(
  RECOVERY_ACTIONS.every((action) => action.minimumEnergyGain >= 16),
  "每次恢复互动都必须在低电量时产生明显恢复",
);
assert.ok(
  RECOVERY_ACTIONS.some((action) => action.id === "wish" && /想做什么/.test(action.label)),
  "状态栏必须允许伴侣主动表达此刻想做的事",
);

assert.equal(
  personalizeCompanionStatusText("用户要我直接作画。", "桃桃"),
  "桃桃要我直接作画。",
);
assert.equal(
  personalizeCompanionStatusText("用户要求我先看图片。", ""),
  "你要求我先看图片。",
);
assert.equal(
  personalizeCompanionStatusText("我正想着该怎么逗桃桃笑。", "桃桃"),
  "我正想着该怎么逗桃桃笑。",
);

let stats = createDefaultCompanionInteractionStats();
const startedAt = Date.parse("2026-07-21T08:00:00.000Z");

for (const action of RECOVERY_ACTIONS) {
  const recoveryStats = recordCompanionInteraction(
    createDefaultCompanionInteractionStats(),
    action.id,
    startedAt,
  );
  const recovery = localCompanionInteractionReaction(
    action,
    recoveryStats,
    1,
    { energyLevel: 1, pulseBpm: 72 },
  );
  assert.ok(recovery.energyTarget >= 1 + action.minimumEnergyGain);
}

for (let index = 0; index < 100; index += 1) {
  stats = recordCompanionInteraction(stats, "hand", startedAt + index * 100);
}

assert.equal(stats.counts.hand, 100);
assert.equal(stats.streakCount, 100);
assert.equal(stats.lastZoneId, "hand");
assert.equal(stats.recentSequence.length, 12);
assert.ok(stats.recentSequence.every((zoneId) => zoneId === "hand"));

const hundredthReaction = localCompanionInteractionReaction(
  handZone,
  stats,
  100,
);
assert.match(hundredthReaction.text, /100/);
assert.match(hundredthReaction.record, /100/);
assert.notEqual(hundredthReaction.mode, "warm");

const switched = recordCompanionInteraction(
  stats,
  "shoulder",
  startedAt + 10_100,
);
assert.equal(switched.counts.shoulder, 1);
assert.equal(switched.streakCount, 1);
assert.equal(switched.lastZoneId, "shoulder");
assert.deepEqual(switched.recentSequence.slice(-2), ["hand", "shoulder"]);

const afterPause = recordCompanionInteraction(
  switched,
  "shoulder",
  startedAt + 41_000,
);
assert.equal(afterPause.counts.shoulder, 2);
assert.equal(afterPause.streakCount, 1);

let queueStats = createDefaultCompanionInteractionStats();
let interactionQueue = [];
for (let index = 0; index < 100; index += 1) {
  const now = startedAt + index * 50;
  queueStats = recordCompanionInteraction(queueStats, "hand", now);
  interactionQueue = enqueueCompanionInteraction({
    queue: interactionQueue,
    zoneId: "hand",
    stats: queueStats,
    sessionId: "session-a",
    now,
    eventId: `event-${index}`,
  });
}
assert.equal(interactionQueue.length, 1);
assert.equal(interactionQueue[0].burstCount, 100);
assert.equal(interactionQueue[0].batchCounts.hand, 100);
assert.equal(interactionQueue[0].interactionCounts.hand, 100);
assert.equal(interactionQueue[0].eventId, "event-0");

queueStats = recordCompanionInteraction(
  queueStats,
  "hand",
  startedAt + 5_100,
);
interactionQueue = enqueueCompanionInteraction({
  queue: interactionQueue,
  zoneId: "hand",
  stats: queueStats,
  sessionId: "session-a",
  now: startedAt + 5_100,
  eventId: "event-100",
});
assert.equal(interactionQueue.length, 2);
assert.equal(interactionQueue[1].burstCount, 1);
assert.equal(interactionQueue[1].interactionCounts.hand, 101);
assert.equal(interactionQueue[1].eventId, "event-100");

queueStats = recordCompanionInteraction(
  queueStats,
  "heart",
  startedAt + 5_150,
);
interactionQueue = enqueueCompanionInteraction({
  queue: interactionQueue,
  zoneId: "heart",
  stats: queueStats,
  sessionId: "session-a",
  now: startedAt + 5_150,
  eventId: "unused-merged-event",
});
assert.equal(interactionQueue[1].burstCount, 2);
assert.deepEqual(interactionQueue[1].batchCounts, {
  hand: 1,
  shoulder: 0,
  heart: 1,
  lamp: 0,
  confide: 0,
  embrace: 0,
  wish: 0,
});
assert.equal(interactionQueue[1].interactionCounts.hand, 101);
assert.equal(interactionQueue[1].interactionCounts.heart, 1);
assert.equal(interactionQueue[1].recentSequence.length, 12);
assert.deepEqual(interactionQueue[1].recentSequence.slice(-2), ["hand", "heart"]);

const firstPreInteractionStatus = {
  ...createDefaultCompanionStatus(),
  mood: "第一次点击前",
  energyLevel: 44,
  pulseBpm: 68,
  revision: 12,
};
const laterPreInteractionStatus = {
  ...firstPreInteractionStatus,
  mood: "第一次点击后的视觉状态",
  energyLevel: 61,
  pulseBpm: 87,
  revision: 13,
};
let statusContractQueue = enqueueCompanionInteraction({
  queue: [],
  zoneId: "hand",
  stats: recordCompanionInteraction(
    createDefaultCompanionInteractionStats(),
    "hand",
    startedAt,
  ),
  sessionId: "session-status-contract",
  preInteractionStatus: firstPreInteractionStatus,
  now: startedAt,
  eventId: "status-contract-first",
});
assert.deepEqual(
  statusContractQueue[0].preInteractionStatus,
  firstPreInteractionStatus,
  "首次入队必须保存点击前状态",
);
statusContractQueue = enqueueCompanionInteraction({
  queue: statusContractQueue,
  zoneId: "heart",
  stats: {
    ...createDefaultCompanionInteractionStats(),
    counts: { hand: 1, shoulder: 0, heart: 1, lamp: 0 },
    lastZoneId: "heart",
    streakCount: 1,
    lastInteractionAt: new Date(startedAt + 100).toISOString(),
    recentSequence: ["hand", "heart"],
  },
  sessionId: "session-status-contract",
  preInteractionStatus: laterPreInteractionStatus,
  now: startedAt + 100,
  eventId: "status-contract-merged",
});
assert.equal(statusContractQueue.length, 1);
assert.deepEqual(
  statusContractQueue[0].preInteractionStatus,
  firstPreInteractionStatus,
  "批次合并必须保留第一次点击前的状态",
);

const unhappyReaction = localCompanionInteractionReaction(
  handZone,
  queueStats,
  3,
  {
    mood: "不开心",
    note: "我现在没心情说话。",
    energyLevel: 18,
    pulseBpm: 70,
  },
);
assert.equal(unhappyReaction.mode, "withdrawn");
assert.equal(unhappyReaction.mood, "不开心");
assert.match(unhappyReaction.text, /不开心|没什么心情/);
assert.match(unhappyReaction.focus, /安静/);

const tiredReactionState = deriveLocalCompanionReactionState(
  shoulderZone,
  {
    ...queueStats,
    lastZoneId: "shoulder",
    streakCount: 4,
  },
  9,
  {
    mood: "很困",
    energyLevel: 12,
  },
);
assert.ok(["tired", "boundary"].includes(tiredReactionState.mode));

const subjectSafeReactionState = deriveLocalCompanionReactionState(
  handZone,
  {
    ...queueStats,
    lastZoneId: "hand",
    streakCount: 1,
  },
  10,
  {
    mood: "平静",
    note: "我知道桃桃今天很难过，正在认真陪着她。",
    energyLevel: 68,
  },
);
assert.notEqual(
  subjectSafeReactionState.mode,
  "withdrawn",
  "用户的难过不能被误判成 AI 自己不开心",
);

let mixedStats = createDefaultCompanionInteractionStats();
mixedStats = recordCompanionInteraction(mixedStats, "hand", startedAt);
mixedStats = recordCompanionInteraction(mixedStats, "shoulder", startedAt + 50);
mixedStats = recordCompanionInteraction(mixedStats, "heart", startedAt + 100);
assert.deepEqual(mixedStats.recentSequence, ["hand", "shoulder", "heart"]);

const variedModes = new Set();
let variedStats = createDefaultCompanionInteractionStats();
for (let index = 0; index < 30; index += 1) {
  variedStats = recordCompanionInteraction(
    variedStats,
    "hand",
    startedAt + index * 100,
  );
  variedModes.add(
    deriveLocalCompanionReactionState(
      handZone,
      variedStats,
      index,
      {
        mood: "开心",
        note: "正在和你开玩笑。",
        energyLevel: 70,
      },
    ).mode,
  );
}
assert.ok(variedModes.size >= 4, "连续互动应跨越多种反应方式");
assert.equal(
  variedModes.has("flirty"),
  false,
  "亲密表达关闭时，本地即时互动不得进入调情方向",
);

const intimateModes = new Set();
let intimateStats = createDefaultCompanionInteractionStats();
for (let index = 0; index < 60; index += 1) {
  intimateStats = recordCompanionInteraction(
    intimateStats,
    "hand",
    startedAt + index * 100,
  );
  intimateModes.add(
    deriveLocalCompanionReactionState(
      handZone,
      intimateStats,
      index,
      {
        mood: "开心",
        note: "正在和你开玩笑。",
        energyLevel: 70,
      },
      { intimateExpressionEnabled: true },
    ).mode,
  );
}
assert.equal(
  intimateModes.has("flirty"),
  true,
  "亲密表达开启时，本地即时互动可以进入调情方向",
);

const normalized = normalizeCompanionInteractionStats({
  counts: { hand: 999999, shoulder: -2, heart: "3", unknown: 9 },
  lastZoneId: "unknown",
  streakCount: 999999,
  lastInteractionAt: "invalid",
});
assert.deepEqual(normalized.counts, {
  hand: 999999,
  shoulder: 0,
  heart: 3,
  lamp: 0,
  confide: 0,
  embrace: 0,
  wish: 0,
});
assert.equal(normalized.lastZoneId, null);
assert.equal(normalized.streakCount, 0);
assert.equal(normalized.lastInteractionAt, null);
assert.deepEqual(normalized.recentSequence, []);

const requestBaseStatus = {
  ...createDefaultCompanionStatus(),
  mood: "等待模型",
  note: "这是请求发出时的状态。",
  revision: 6,
};
const serverInteractionStatus = {
  ...requestBaseStatus,
  mood: "模型回复",
  note: "这是较早请求返回的状态。",
  revision: 7,
};
const advancedLocalStatus = {
  ...requestBaseStatus,
  mood: "刚刚又被点了一次",
  note: "保留请求发出后的新互动。",
  revision: 7,
};
assert.equal(
  mergeCompanionStatus(requestBaseStatus, serverInteractionStatus, {
    baseRevision: requestBaseStatus.revision,
  }).mood,
  "模型回复",
);
assert.equal(
  mergeCompanionStatus(advancedLocalStatus, serverInteractionStatus, {
    baseRevision: requestBaseStatus.revision,
  }).mood,
  "刚刚又被点了一次",
  "请求发出后的本地互动不能被旧模型响应覆盖",
);

const optimisticBatchStatus = {
  ...requestBaseStatus,
  mood: "批次的本地即时反应",
  note: "两次点击已经先在界面上显示。",
  energyLevel: 88,
  pulseBpm: 104,
  revision: 8,
};
const serverStatusFromPreInteraction = {
  ...requestBaseStatus,
  mood: "模型理解后的批次反应",
  note: "模型只基于第一次点击前状态计算。",
  energyLevel: 71,
  pulseBpm: 83,
  revision: 7,
};
const batchResponseBaseRevision = requestBaseStatus.revision + 2;
const mergedBatchStatus = mergeCompanionStatus(
  optimisticBatchStatus,
  serverStatusFromPreInteraction,
  { baseRevision: batchResponseBaseRevision },
);
assert.equal(mergedBatchStatus.mood, "模型理解后的批次反应");
assert.equal(mergedBatchStatus.energyLevel, 71);
assert.equal(mergedBatchStatus.pulseBpm, 83);
assert.equal(
  mergedBatchStatus.revision,
  optimisticBatchStatus.revision,
  "应用基于点击前状态生成的响应时 revision 不能倒退",
);
const clickedDuringRequestStatus = {
  ...optimisticBatchStatus,
  mood: "请求期间又点了一次",
  revision: optimisticBatchStatus.revision + 1,
};
assert.equal(
  mergeCompanionStatus(
    clickedDuringRequestStatus,
    serverStatusFromPreInteraction,
    { baseRevision: batchResponseBaseRevision },
  ).mood,
  "请求期间又点了一次",
  "请求期间的新点击不能被批次响应覆盖",
);

console.log("frontend companion interaction tests passed");
