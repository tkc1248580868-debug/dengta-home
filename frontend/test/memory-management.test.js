import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);

assert.match(appSource, /\/api\/v2\/memories\/\$\{item\.id\}/);
assert.match(appSource, /method:\s*"PATCH"/);
assert.match(appSource, /method:\s*"DELETE"/);
assert.match(appSource, /aria-label="修改长期记忆"/);
assert.match(appSource, />\s*修改\s*</);
assert.match(appSource, />\s*删除\s*</);

console.log("memory edit and delete UI checks passed");
