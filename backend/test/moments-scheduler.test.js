const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);
const v2Content = fs.readFileSync(
    path.join(__dirname, "..", "routes", "v2", "content.js"),
    "utf8"
);

assert.match(
    v2Content,
    /randomDelaySeconds\(\s*60,\s*10 \* 60 \* 60,\s*random\s*\)/,
    "a user moment should schedule an irregular internal evaluation window"
);
assert.match(
    v2Content,
    /job_type: "moment_interaction"[\s\S]*?dedupe_key: `moment:\$\{data\.id\}:initial`/,
    "a new user moment must enqueue a deduplicated persistent interaction job"
);
assert.match(
    v2Content,
    /dedupe_key: `moment-comment:\$\{data\.id\}`[\s\S]*?comment_id: data\.id/,
    "a new user comment must enqueue its own deduplicated persistent job"
);
assert.doesNotMatch(
    v2Content.match(/function publicMoment\(moment\) \{[\s\S]*?\n\}/)?.[0] || "",
    /reply_due_at|reply_status/,
    "internal scheduling state must not be exposed as a visible countdown"
);
assert.match(
    source,
    /if \(!authRequired\) \{\s*momentMaintenanceTimer = setInterval/,
    "the legacy global scheduler may only run in explicit non-authenticated mode"
);

console.log("moment background scheduling regression tests passed");
