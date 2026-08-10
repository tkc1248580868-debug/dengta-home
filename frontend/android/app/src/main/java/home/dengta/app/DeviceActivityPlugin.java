package home.dengta.app;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "DeviceActivity")
public final class DeviceActivityPlugin extends Plugin {
    private static final String PREFERENCES = "dengta_device_activity";
    private static final String ENABLED_KEY = "enabled";
    private static final int DEFAULT_WINDOW_MINUTES = 30;
    private static final int MAX_APPS = 6;

    private static final String[] PRIVATE_APP_MARKERS = {
        "bank", "banking", "pay", "payment", "wallet", "finance",
        "credit", "password", "passwd", "authenticator",
        "keychain", "vault", "token", "otp", "银行", "支付", "钱包",
        "密码", "验证器", "认证器", "令牌"
    };

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(buildState());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("缺少活动感知开关状态。");
            return;
        }
        preferences().edit().putBoolean(ENABLED_KEY, enabled).apply();
        call.resolve(buildState());
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(buildState());
        } catch (Exception directSettingsError) {
            try {
                Intent fallback = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve(buildState());
            } catch (Exception error) {
                call.reject("无法打开系统使用情况访问授权页。");
            }
        }
    }

    @PluginMethod
    public void getRecentSummary(PluginCall call) {
        JSObject state = buildState();
        if (!state.getBoolean("supported", false)) {
            call.reject("当前 Android 版本不支持活动摘要。");
            return;
        }
        if (!state.getBoolean("enabled", false)) {
            call.reject("活动感知尚未开启。");
            return;
        }
        if (!state.getBoolean("permissionGranted", false)) {
            call.reject("尚未授予使用情况访问权限。");
            return;
        }

        int windowMinutes = boundedWindow(call.getInt("windowMinutes"));
        long endTime = System.currentTimeMillis();
        long startTime = endTime - windowMinutes * 60_000L;
        try {
            UsageStatsManager manager = (UsageStatsManager) getContext()
                .getSystemService(Context.USAGE_STATS_SERVICE);
            if (manager == null) {
                call.reject("系统没有提供活动统计服务。");
                return;
            }

            Map<String, ActivityRecord> records = new HashMap<>();
            UsageEvents events = manager.queryEvents(startTime, endTime);
            UsageEvents.Event event = new UsageEvents.Event();
            while (events != null && events.hasNextEvent()) {
                events.getNextEvent(event);
                String packageName = cleanPackageName(event.getPackageName());
                if (packageName.isEmpty() || isAlwaysExcluded(packageName)) continue;

                int eventType = event.getEventType();
                long eventTime = Math.max(startTime, Math.min(endTime, event.getTimeStamp()));
                ActivityRecord record = records.computeIfAbsent(
                    packageName,
                    ignored -> new ActivityRecord(packageName)
                );
                if (eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                    if (record.activeSince < 0L) {
                        record.activeSince = eventTime;
                        record.launchCount += 1;
                    }
                } else if (
                    eventType == UsageEvents.Event.ACTIVITY_PAUSED ||
                    eventType == UsageEvents.Event.ACTIVITY_STOPPED
                ) {
                    record.finish(eventTime);
                }
            }
            for (ActivityRecord record : records.values()) {
                record.finish(endTime);
            }

            Map<String, UsageStats> aggregate = manager.queryAndAggregateUsageStats(
                startTime,
                endTime
            );
            if (aggregate != null) {
                for (Map.Entry<String, UsageStats> item : aggregate.entrySet()) {
                    String packageName = cleanPackageName(item.getKey());
                    if (packageName.isEmpty() || isAlwaysExcluded(packageName)) continue;
                    UsageStats usage = item.getValue();
                    if (usage == null || usage.getTotalTimeInForeground() <= 0L) continue;
                    ActivityRecord record = records.computeIfAbsent(
                        packageName,
                        ignored -> new ActivityRecord(packageName)
                    );
                    record.foregroundMillis = Math.max(
                        record.foregroundMillis,
                        Math.min(
                            endTime - startTime,
                            usage.getTotalTimeInForeground()
                        )
                    );
                }
            }

            List<ActivityRecord> visible = new ArrayList<>();
            for (ActivityRecord record : records.values()) {
                record.name = applicationName(record.packageName);
                if (
                    record.foregroundMillis <= 0L ||
                    isPrivateApp(record.packageName, record.name)
                ) {
                    continue;
                }
                visible.add(record);
            }
            visible.sort(
                Comparator.comparingLong((ActivityRecord item) -> item.foregroundMillis)
                    .reversed()
                    .thenComparing(
                        Comparator.comparingInt((ActivityRecord item) -> item.launchCount)
                            .reversed()
                    )
            );

            JSArray apps = new JSArray();
            for (int index = 0; index < Math.min(MAX_APPS, visible.size()); index += 1) {
                ActivityRecord record = visible.get(index);
                JSObject app = new JSObject();
                app.put("name", record.name);
                app.put("launchCount", Math.min(100, Math.max(0, record.launchCount)));
                app.put(
                    "foregroundSeconds",
                    Math.min(
                        windowMinutes * 60,
                        Math.max(0L, Math.round(record.foregroundMillis / 1000.0))
                    )
                );
                apps.put(app);
            }

            JSObject result = new JSObject();
            result.put("capturedAt", isoTimestamp(endTime));
            result.put("windowMinutes", windowMinutes);
            result.put("apps", apps);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("使用情况访问权限已经失效，请重新授权。");
        } catch (Exception error) {
            call.reject("暂时无法读取活动摘要。");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        preferences().edit().clear().apply();
        call.resolve(buildState());
    }

    private JSObject buildState() {
        JSObject state = new JSObject();
        state.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP);
        state.put("enabled", preferences().getBoolean(ENABLED_KEY, false));
        state.put("permissionGranted", hasUsageAccess());
        return state;
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private boolean hasUsageAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false;
        AppOpsManager manager = (AppOpsManager) getContext()
            .getSystemService(Context.APP_OPS_SERVICE);
        if (manager == null) return false;
        int mode;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            mode = manager.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                getContext().getPackageName()
            );
        } else {
            mode = manager.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                getContext().getPackageName()
            );
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    private static int boundedWindow(Integer value) {
        int requested = value == null ? DEFAULT_WINDOW_MINUTES : value;
        return Math.min(120, Math.max(5, requested));
    }

    private String applicationName(String packageName) {
        try {
            PackageManager manager = getContext().getPackageManager();
            ApplicationInfo info = manager.getApplicationInfo(packageName, 0);
            String label = String.valueOf(manager.getApplicationLabel(info)).trim();
            if (!label.isEmpty()) return truncate(label, 40);
        } catch (Exception ignored) {
            // Package visibility differs across Android vendors; use a neutral name.
        }
        return "其他应用";
    }

    private boolean isAlwaysExcluded(String packageName) {
        String ownPackage = getContext().getPackageName();
        String value = packageName.toLowerCase(Locale.ROOT);
        return packageName.equals(ownPackage) ||
            value.equals("com.android.systemui") ||
            value.contains("launcher") ||
            value.contains("permissioncontroller") ||
            value.contains("packageinstaller");
    }

    private static boolean isPrivateApp(String packageName, String label) {
        String value = (packageName + " " + label).toLowerCase(Locale.ROOT);
        for (String marker : PRIVATE_APP_MARKERS) {
            if (value.contains(marker)) return true;
        }
        return false;
    }

    private static String cleanPackageName(String value) {
        if (value == null) return "";
        return truncate(value.trim(), 200);
    }

    private static String truncate(String value, int maxLength) {
        if (value.length() <= maxLength) return value;
        return value.substring(0, maxLength);
    }

    private static String isoTimestamp(long value) {
        java.text.SimpleDateFormat formatter = new java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            Locale.US
        );
        formatter.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return formatter.format(new java.util.Date(value));
    }

    private static final class ActivityRecord {
        final String packageName;
        String name = "其他应用";
        long activeSince = -1L;
        long foregroundMillis = 0L;
        int launchCount = 0;

        ActivityRecord(String packageName) {
            this.packageName = packageName;
        }

        void finish(long endTime) {
            if (activeSince < 0L) return;
            foregroundMillis += Math.max(0L, endTime - activeSince);
            activeSince = -1L;
        }
    }
}
