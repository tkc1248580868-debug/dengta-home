# Self-hosting DengTa Home

## Components

1. Supabase Auth, Postgres and Storage
2. DengTa Express backend
3. DengTa React frontend
4. Optional voice, notification and MCP services

## Supabase

Create a new project and apply every SQL migration in `backend/supabase/` in numeric order. Use the project URL and anon key in the frontend. Keep the secret/service-role key on the backend only.

## Backend

Deploy `backend/` to a Node.js 24 runtime. Copy the variable names from `backend/.env.example` into the platform's secret manager. Set `AUTH_REQUIRED=true` for internet-facing deployments and restrict `FRONTEND_URL` to the deployed frontend origin.

Do not place secrets in build arguments, repository variables visible to pull requests, client-side `VITE_*` values or Docker image layers.

## Frontend

Deploy `frontend/` as a Vite static app. Configure `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` during the build. The anon key is designed for browser use, but database Row Level Security must still be enabled and tested.

## Android

Run `npm run android:apk` from `frontend/` — it validates the toolchain and `VITE_*` values, builds the web bundle, runs Capacitor sync and invokes Gradle with `DENGTA_BACKEND_API_URL` set, so background notifications and screen sharing reach your own backend. The step-by-step guide, including installing on a phone and release signing, is in [ANDROID.md](ANDROID.md).

The backend must be reachable over `https://`: the Android shell sets `cleartext: false`. Release signing material is intentionally not included in this repository; `frontend/android/keystore.properties` and keystore files are git-ignored.

The manual GitHub Actions APK workflow requires three Repository Secrets: `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is intended for client use, but it must still be paired with tested Row Level Security. The workflow reuses `VITE_API_URL` as `DENGTA_BACKEND_API_URL` for native background services.

## Background jobs

Leave background jobs disabled until all required migrations are applied. Configure trigger secrets and worker identity only in the deployment platform. Start with one worker, then raise concurrency after observing database load and provider rate limits.

## Before going live

- run frontend and backend tests;
- verify Row Level Security with two separate accounts;
- verify CORS and authentication failures;
- rotate any key that has ever appeared in a log or local export;
- test database restore, not only backup creation;
- run `scripts/public-release-audit.ps1`.
