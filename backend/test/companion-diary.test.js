const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);
const aiService = fs.readFileSync(
    path.join(__dirname, "..", "services", "ai-service.js"),
    "utf8"
);
const migration = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "009_companion_diary.sql"),
    "utf8"
);

assert.match(migration, /create table if not exists public\.companion_diary_entries/i);
assert.match(migration, /source_message_ids jsonb/i);
assert.match(migration, /source_window_start timestamptz/i);
assert.match(migration, /source_window_end timestamptz/i);
assert.match(server, /messages\.length < 8 \|\| userCount < 3 \|\| assistantCount < 3/);
assert.match(server, /沿用个性化指令决定的叙事世界/);
assert.match(server, /source_message_ids: messages\.map/);
assert.match(server, /source_message_count: sourceIds\.length/);
assert.match(server, /app\.get\("\/diary"/);
assert.match(
    server,
    /if \(!authRequired\) \{[\s\S]*?diaryMaintenanceTimer = setInterval/,
    "the legacy global diary timer must stay disabled in multi-user production"
);
assert.match(aiService, /purpose === "diary"/);
assert.match(aiService, /私人记忆日记模块/);
assert.match(aiService, /保持人物、时间、事件和情绪内部连贯/);
assert.match(aiService, /buildModuleSystemInstructions/);

console.log("real companion diary generation regression tests passed");
