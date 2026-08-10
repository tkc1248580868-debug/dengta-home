import assert from "node:assert/strict";
import {
  buildCcSwitchBridgeHtml,
  buildCcSwitchDeepLink,
  ccSwitchBridgeFileName,
  ccSwitchTargetsForProtocol,
} from "../src/cc-switch-bridge.js";

const codexTargets = ccSwitchTargetsForProtocol("openai-responses");
assert.deepEqual(codexTargets.map((target) => target.value), ["codex"]);

const chatTargets = ccSwitchTargetsForProtocol("openai-chat");
assert.deepEqual(
  chatTargets.map((target) => target.value),
  ["opencode", "openclaw", "hermes"],
);

const link = buildCcSwitchDeepLink({
  name: "我的 Responses",
  protocol: "openai-responses",
  baseUrl: "https://api.example.com/v1/",
  apiKey: "sk-local-test",
  model: "gpt-5.5",
  targetApp: "codex",
});
const url = new URL(link);
assert.equal(url.protocol, "ccswitch:");
assert.equal(url.hostname, "v1");
assert.equal(url.pathname, "/import");
assert.equal(url.searchParams.get("resource"), "provider");
assert.equal(url.searchParams.get("app"), "codex");
assert.equal(url.searchParams.get("endpoint"), "https://api.example.com/v1");
assert.equal(url.searchParams.get("apiKey"), "sk-local-test");
assert.equal(url.searchParams.get("model"), "gpt-5.5");
assert.equal(url.searchParams.get("enabled"), "false");

assert.throws(
  () => buildCcSwitchDeepLink({
    name: "Chat",
    protocol: "openai-chat",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    targetApp: "codex",
  }),
  /不能导入到所选目标工具/,
);

assert.throws(
  () => buildCcSwitchDeepLink({
    name: "No key",
    protocol: "openai-responses",
    baseUrl: "https://api.example.com/v1",
    apiKey: "",
    targetApp: "codex",
  }),
  /要求填写 API Key/,
);

const bridgeHtml = buildCcSwitchBridgeHtml({
  name: "Provider </script><script>alert(1)</script>",
  protocol: "openai-responses",
  base_url: "https://api.example.com/v1",
  default_model: "gpt-5.5",
}, "codex");
assert.match(bridgeHtml, /DengTa · CC Switch 本机桥接/);
assert.match(bridgeHtml, /ccswitch:\/\/v1\/import/);
assert.doesNotMatch(bridgeHtml, /<\/script><script>alert/);
assert.doesNotMatch(bridgeHtml, /sk-local-test/);
assert.doesNotMatch(bridgeHtml, /localStorage/);

assert.equal(
  ccSwitchBridgeFileName({ name: "测试/接口:*?" }),
  "DengTa-CCSwitch-测试-接口.html",
);

console.log("CC Switch bridge tests passed");
