import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mergeDeviceActivityContext,
  normalizeDeviceActivityState,
  normalizeDeviceActivitySummary,
} from "../src/device-activity.js";

assert.deepEqual(normalizeDeviceActivityState({}), {
  supported: false,
  enabled: false,
  permissionGranted: false,
});
assert.deepEqual(
  normalizeDeviceActivityState({
    supported: true,
    enabled: true,
    permissionGranted: true,
  }),
  { supported: true, enabled: true, permissionGranted: true },
);

const summary = normalizeDeviceActivitySummary({
  capturedAt: "2026-07-29T02:30:00.000Z",
  windowMinutes: 30,
  apps: [
    {
      name: "微信",
      packageName: "com.tencent.mm",
      launchCount: 3,
      foregroundSeconds: 721,
      screenText: "不得进入上下文",
    },
    { name: "哔哩哔哩", launchCount: 1, foregroundSeconds: 480 },
  ],
});
assert.deepEqual(summary, {
  capturedAt: "2026-07-29T02:30:00.000Z",
  windowMinutes: 30,
  apps: [
    { name: "微信", launchCount: 3, foregroundMinutes: 12 },
    { name: "哔哩哔哩", launchCount: 1, foregroundMinutes: 8 },
  ],
});
assert.deepEqual(
  mergeDeviceActivityContext({ weather: { temperatureC: 28 } }, summary),
  {
    weather: { temperatureC: 28 },
    deviceActivity: summary,
  },
);
assert.deepEqual(
  mergeDeviceActivityContext({ weather: { temperatureC: 28 } }, null),
  { weather: { temperatureC: 28 } },
);

const manifest = fs.readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
const activity = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/MainActivity.java",
    import.meta.url,
  ),
  "utf8",
);
const plugin = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/DeviceActivityPlugin.java",
    import.meta.url,
  ),
  "utf8",
);
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

assert.match(manifest, /android\.permission\.PACKAGE_USAGE_STATS/);
assert.match(activity, /registerPlugin\(DeviceActivityPlugin\.class\)/);
assert.match(plugin, /UsageStatsManager/);
assert.match(plugin, /AppOpsManager\.OPSTR_GET_USAGE_STATS/);
assert.match(plugin, /Settings\.ACTION_USAGE_ACCESS_SETTINGS/);
assert.match(plugin, /getRecentSummary/);
assert.match(plugin, /foregroundSeconds/);
assert.match(plugin, /bank|pay|wallet|password|authenticator/i);
assert.doesNotMatch(plugin, /MediaProjection|ImageReader|PixelCopy|takeScreenshot/i);
assert.match(app, /活动感知（只读取 App 名称）/);
assert.match(app, /打开系统授权/);

console.log("device activity privacy and Android bridge tests passed");
