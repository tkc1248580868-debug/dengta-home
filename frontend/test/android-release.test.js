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

const androidGuide = fs.readFileSync(
  path.join(projectRoot, "..", "docs", "ANDROID.md"),
  "utf8",
);
const androidIgnore = fs.readFileSync(
  path.join(projectRoot, "android", ".gitignore"),
  "utf8",
);
const buildScript = fs.readFileSync(
  path.join(projectRoot, "scripts", "build-android.sh"),
  "utf8",
);
const buildScriptWindows = fs.readFileSync(
  path.join(projectRoot, "scripts", "build-android.ps1"),
  "utf8",
);

assert.match(buildGradle, /applicationId "home\.dengta\.app"/);
assert.match(buildGradle, /versionCode 34\b/);
assert.match(buildGradle, /versionName "2\.8\.12"/);
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

// Release signing stays opt-in and local: the build must fall back to an
// unsigned release when keystore.properties is absent, and the repository must
// refuse to track signing material.
assert.match(buildGradle, /rootProject\.file\("keystore\.properties"\)/);
assert.match(buildGradle, /if \(hasReleaseSigning\) \{\s*signingConfig signingConfigs\.release/);
for (const ignored of ["*.jks", "*.keystore", "*.p12", "keystore.properties"]) {
  assert.ok(
    androidIgnore.split(/\r?\n/).includes(ignored),
    `android/.gitignore must exclude ${ignored}`,
  );
}

// Both build scripts must refuse a cleartext backend, because the Capacitor
// shell sets cleartext=false and such an APK cannot reach its backend at all.
for (const [name, script] of [
  ["build-android.sh", buildScript],
  ["build-android.ps1", buildScriptWindows],
]) {
  assert.match(script, /VITE_SUPABASE_ANON_KEY/, `${name} must require the anon key`);
  assert.match(script, /DENGTA_BACKEND_API_URL/, `${name} must pass the native backend URL`);
  assert.match(script, /cleartext=false/, `${name} must reject http:// backends`);
}

assert.match(androidWorkflow, /VITE_API_URL must use https:\/\//);
assert.match(androidGuide, /minSdkVersion|API 31/);
assert.match(androidGuide, /keystore\.properties/);

console.log("Android 2.8.12 cancellable-generation release tests passed");
