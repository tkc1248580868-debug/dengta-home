# Android performance budget

## Why this exists

The vivo X200 Ultra regression in July 2026 was caused by forcing the entire
Capacitor WebView onto `View.LAYER_TYPE_SOFTWARE`. The app still looked correct,
but every animated glass surface was rasterized on the CPU.

The measured failure was deterministic:

| Scenario | Before | After |
| --- | --- | --- |
| Idle status animation | 100% janky frames, P95 250 ms | 1.10% janky frames, P95 13 ms |
| Chat scrolling | 100% janky frames, P95 250 ms | 0.56% janky frames, P95 13 ms |
| Status and page transitions | Not usable | 3.27% janky frames, P95 24 ms |

`MainActivity` now uses the normal Android rendering path while retaining the
`onRenderProcessGone` listener and safe activity recreation.

## Repeatable device check

Connect an Android device, then run:

```powershell
.\scripts\android-perf-check.ps1 `
  -Device "DEVICE_IP:ADB_PORT" `
  -Adb "PATH_TO_ANDROID_SDK\platform-tools\adb.exe"
```

The check exercises idle animation, repeated chat scrolling, the expandable
status surface, all five destinations through the left sidebar, and repeated
Settings scrolling. When only
one USB device is connected, `-Device` can be omitted. It fails when
P95 frame time exceeds 32 ms, while the Settings-specific path has a stricter
24 ms limit. For samples containing at least 30 rendered
frames, it also fails when janky frames exceed 20%; sparse idle samples use P95
because a handful of setup frames makes the percentage statistically unstable.
Deferred feature pages are opened once before frame collection so the navigation
scenario measures steady-state motion; initial JavaScript remains guarded by
`test/initial-bundle-budget.test.js`.

## Motion rules

- Keep runtime motion on `transform` and `opacity`.
- Do not force `LAYER_TYPE_SOFTWARE`.
- Repeated cards must not use their own `backdrop-filter`.
- Full-screen Settings backgrounds must use pre-feathered gradients; animated
  Settings layers may only change `transform` and `opacity`, and pause while
  the Settings scroller is moving.
- Do not use fixed background attachment inside mobile WebView scrolling
  surfaces.
- Keep the WebView renderer recovery listener and validate cold launch,
  foreground/background switching, and navigation after rendering changes.
- Run the device performance check after every material or animation update.

## Current launch sequence

The cold-launch thread forms a single-line `DENGTA` wordmark, collapses
vertically into a straight line, aligns the rose tip to the line endpoint, and
then reveals the app. The launch and interface transition keyframes are guarded
by `test/native-motion.test.js`.
