import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./cozy-theme.css";
import "./auth.css";
import "./native-feel.css";
import "./apple-ui.css";
import "./sun-glass-ui.css";
import "./jelly-motion.css";
import "./sun-glass-chat.css";
import App from "./LazyApp.jsx";
import AuthGate from "./AuthGate.jsx";
import DengTaPrelude from "./DengTaPrelude.jsx";
import { prewarmBackend } from "./backend-prewarm.js";

void prewarmBackend();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <DengTaPrelude />
    <AuthGate>
      {({ accountControl, snapshot }) => (
        <Suspense fallback={null}>
          <App
            key={snapshot.user?.id}
            accountControl={accountControl}
            accountScope={snapshot.user?.id || ""}
            userName={snapshot.user?.displayName}
          />
        </Suspense>
      )}
    </AuthGate>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service Worker 注册失败：", error);
    });
  });
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    .catch(() => {
      // 开发环境清理失败不会影响页面调试。
    });
}
