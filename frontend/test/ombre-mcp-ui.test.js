import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync(
  new URL("../src/OmbreMemories.jsx", import.meta.url),
  "utf8",
);
const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

assert.match(component, /apiRequest\("\/api\/ombre\/mcp\/status"\)/);
assert.match(component, /MCP 记忆协议/);
assert.match(component, /等待 OMBRE_BRAIN_URL/);
assert.match(component, /mcpConnection\.tools\.slice\(0, 6\)/);
assert.match(css, /\.ombre-mcp-strip\.connected/);
assert.match(css, /\.ombre-mcp-strip\.unavailable/);

console.log("frontend Ombre MCP status tests passed");
