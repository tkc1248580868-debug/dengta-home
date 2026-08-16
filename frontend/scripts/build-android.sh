#!/usr/bin/env bash
# Builds the DengTa home Android APK in one command.
# Run: frontend/scripts/build-android.sh [debug|release]
# Needs: Node.js 24, JDK 21, Android SDK (platform 36, build-tools 36).
set -euo pipefail

variant="${1:-debug}"
if [ "$variant" != "debug" ] && [ "$variant" != "release" ]; then
  echo "Unknown variant '$variant'. Use 'debug' or 'release'." >&2
  exit 1
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
frontend_directory="$(dirname "$script_directory")"
cd "$frontend_directory"

fail() {
  echo "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js 24 is required but was not found on PATH."
command -v java >/dev/null 2>&1 || fail "JDK 21 is required but was not found on PATH."

if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ] && [ ! -f android/local.properties ]; then
  fail "Set ANDROID_HOME (or ANDROID_SDK_ROOT), or create frontend/android/local.properties with sdk.dir=/path/to/Android/sdk."
fi

# Vite reads .env.local itself, but Gradle does not. Load it here so the native
# background services and the web bundle agree on the same backend origin.
if [ -f .env.local ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
      VITE_*=*)
        name="${line%%=*}"
        value="${line#*=}"
        value="${value%$'\r'}"
        if [ -z "${!name:-}" ]; then
          export "$name=$value"
        fi
        ;;
    esac
  done < .env.local
fi

for required in VITE_API_URL VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; do
  if [ -z "${!required:-}" ]; then
    fail "$required is not set. Export it, or copy .env.example to frontend/.env.local and fill it in."
  fi
done

case "$VITE_API_URL" in
  https://*) ;;
  http://localhost*|http://127.0.0.1*)
    echo "Warning: VITE_API_URL is a loopback address. A phone cannot reach the host machine's localhost." >&2
    ;;
  http://*)
    fail "VITE_API_URL uses http://. The Android shell sets cleartext=false, so the backend must be served over https://."
    ;;
esac

if [ "$variant" = "release" ] && [ ! -f android/keystore.properties ]; then
  fail "Release builds need signing material. Create frontend/android/keystore.properties (see docs/ANDROID.md); it is git-ignored."
fi

echo "==> Building web bundle"
npm run build

echo "==> Syncing Capacitor Android project"
npx cap sync android

echo "==> Assembling $variant APK"
chmod +x android/gradlew
if [ "$variant" = "debug" ]; then
  gradle_task="assembleDebug"
else
  gradle_task="assembleRelease"
fi
(cd android && DENGTA_BACKEND_API_URL="$VITE_API_URL" ./gradlew "$gradle_task")

apk_path="android/app/build/outputs/apk/$variant/app-$variant.apk"
[ -f "$apk_path" ] || fail "Gradle finished but $apk_path was not produced."

echo
echo "APK ready: $frontend_directory/$apk_path"
echo "Install over USB with: adb install -r \"$frontend_directory/$apk_path\""
