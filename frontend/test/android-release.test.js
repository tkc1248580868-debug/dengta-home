import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");
const buildGradle = fs.readFileSync(
  path.join(projectRoot, "android", "app", "build.gradle"),
  "utf8",
);
const variablesGradle = fs.readFileSync(
  path.join(projectRoot, "android", "variables.gradle"),
  "utf8",
);
const androidWorkflow = fs.readFileSync(
  path.join(projectRoot, "..", ".github", "workflows", "android-apk.yml"),
  "utf8",
);
const mainActivity = fs.readFileSync(
  path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "java",
    "home",
    "dengta",
    "app",
    "MainActivity.java",
  ),
  "utf8",
);
const screenGlanceService = fs.readFileSync(
  path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "java",
    "home",
    "dengta",
    "app",
    "ScreenGlanceService.java",
  ),
  "utf8",
);

assert.match(buildGradle, /applicationId "home\.dengta\.app"/);
assert.match(buildGradle, /versionCode 32\b/);
assert.match(buildGradle, /versionName "2\.8\.10"/);
assert.match(variablesGradle, /minSdkVersion = 31\b/);
assert.match(variablesGradle, /targetSdkVersion = 36\b/);
assert.match(androidWorkflow, /npm test\s+npm run lint/);
assert.match(
  androidWorkflow,
  /VITE_SUPABASE_URL: \$\{\{ secrets\.VITE_SUPABASE_URL \}\}/,
);
assert.match(
  androidWorkflow,
  /VITE_SUPABASE_ANON_KEY: \$\{\{ secrets\.VITE_SUPABASE_ANON_KEY \}\}/,
);
assert.match(androidWorkflow, /test -n "\$VITE_SUPABASE_URL"/);
assert.match(androidWorkflow, /test -n "\$VITE_SUPABASE_ANON_KEY"/);
assert.match(
  mainActivity,
  /onRenderProcessGone/,
  "the activity must recover when Android WebView loses its renderer",
);
assert.doesNotMatch(
  mainActivity,
  /LAYER_TYPE_SOFTWARE/,
  "the embedded WebView must not force CPU-only rendering",
);
assert.doesNotMatch(
  screenGlanceService,
  /小灯|桃桃/,
  "native background notifications must not ship a private companion identity",
);
console.log("Android 2.8.10 startup and chat latency release tests passed");
