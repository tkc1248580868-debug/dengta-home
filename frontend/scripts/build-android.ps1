# Builds the DengTa home Android APK in one command.
# Run: powershell -ExecutionPolicy Bypass -File frontend/scripts/build-android.ps1 [-Variant debug|release]
# Needs: Node.js 24, JDK 21, Android SDK (platform 36, build-tools 36), PowerShell 5.1+.
[CmdletBinding()]
param(
  [ValidateSet('debug', 'release')]
  [string]$Variant = 'debug'
)

$ErrorActionPreference = 'Stop'
$frontendDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $frontendDirectory

function Assert-Command {
  param([string]$Name, [string]$Message)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw $Message
  }
}

Assert-Command -Name 'node' -Message 'Node.js 24 is required but was not found on PATH.'
Assert-Command -Name 'java' -Message 'JDK 21 is required but was not found on PATH.'

$localProperties = Join-Path $frontendDirectory 'android/local.properties'
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT -and -not (Test-Path -LiteralPath $localProperties)) {
  throw 'Set ANDROID_HOME (or ANDROID_SDK_ROOT), or create frontend/android/local.properties with sdk.dir pointing at the Android SDK.'
}

# Vite reads .env.local itself, but Gradle does not. Load it here so the native
# background services and the web bundle agree on the same backend origin.
$envFile = Join-Path $frontendDirectory '.env.local'
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*VITE_[A-Z0-9_]+\s*=') {
      $name, $value = $line -split '=', 2
      $name = $name.Trim()
      if (-not [Environment]::GetEnvironmentVariable($name)) {
        [Environment]::SetEnvironmentVariable($name, $value.Trim())
      }
    }
  }
}

foreach ($required in @('VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY')) {
  if (-not [Environment]::GetEnvironmentVariable($required)) {
    throw "$required is not set. Set it, or copy .env.example to frontend/.env.local and fill it in."
  }
}

$apiUrl = [Environment]::GetEnvironmentVariable('VITE_API_URL')
if ($apiUrl -match '^http://(localhost|127\.0\.0\.1)') {
  Write-Warning 'VITE_API_URL is a loopback address. A phone cannot reach the host machine''s localhost.'
}
elseif ($apiUrl -notmatch '^https://') {
  throw 'VITE_API_URL uses http://. The Android shell sets cleartext=false, so the backend must be served over https://.'
}

if ($Variant -eq 'release' -and -not (Test-Path -LiteralPath (Join-Path $frontendDirectory 'android/keystore.properties'))) {
  throw 'Release builds need signing material. Create frontend/android/keystore.properties (see docs/ANDROID.md); it is git-ignored.'
}

Write-Output '==> Building web bundle'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }

Write-Output '==> Syncing Capacitor Android project'
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }

Write-Output "==> Assembling $Variant APK"
$gradleTask = if ($Variant -eq 'debug') { 'assembleDebug' } else { 'assembleRelease' }
$env:DENGTA_BACKEND_API_URL = $apiUrl
Push-Location (Join-Path $frontendDirectory 'android')
try {
  & .\gradlew.bat $gradleTask
  if ($LASTEXITCODE -ne 0) { throw "Gradle $gradleTask failed." }
}
finally {
  Pop-Location
}

$apkPath = Join-Path $frontendDirectory "android/app/build/outputs/apk/$Variant/app-$Variant.apk"
if (-not (Test-Path -LiteralPath $apkPath)) {
  throw "Gradle finished but $apkPath was not produced."
}

Write-Output ''
Write-Output "APK ready: $apkPath"
Write-Output "Install over USB with: adb install -r `"$apkPath`""
