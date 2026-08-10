package home.dengta.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundNotifications")
public final class BackgroundNotificationsPlugin extends Plugin {
    @PluginMethod
    public void configure(PluginCall call) {
        String installationToken = clean(
            call.getString("installationToken"),
            8192
        );
        Long expiresAtValue = call.getLong("expiresAt");
        long expiresAt = expiresAtValue == null
            ? 0L
            : expiresAtValue;
        String deviceId = clean(call.getString("deviceId"), 80);
        String userId = clean(call.getString("userId"), 80);
        String companionId = clean(call.getString("companionId"), 80);
        if (
            installationToken.isEmpty() ||
            expiresAt <= 0L ||
            deviceId.isEmpty() ||
            userId.isEmpty() ||
            companionId.isEmpty()
        ) {
            call.reject("登录身份或伴侣作用域不完整。");
            return;
        }
        try {
            String nextScope = userId + ":" + companionId;
            boolean scopeChanged = !nextScope.equals(
                BackgroundNotificationCredentials.currentScopeKey(
                    getContext()
                )
            );
            BackgroundNotificationCredentials.store(
                getContext(),
                installationToken,
                expiresAt,
                deviceId,
                userId,
                companionId
            );
            PushNotificationWorker.configure(
                getContext(),
                scopeChanged
            );
            JSObject result = new JSObject();
            result.put("configured", true);
            result.put("scopeChanged", scopeChanged);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法安全保存后台通知登录状态。");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        BackgroundNotificationCredentials.clear(getContext());
        PushNotificationWorker.clear(getContext());
        JSObject result = new JSObject();
        result.put("configured", false);
        call.resolve(result);
    }

    private static String clean(String value, int maxLength) {
        if (value == null) return "";
        String normalized = value.trim();
        if (normalized.length() <= maxLength) return normalized;
        return normalized.substring(0, maxLength);
    }
}
