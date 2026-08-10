package home.dengta.app;

import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "DengTaMainActivity";
    private boolean rendererRecoveryScheduled = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundNotificationsPlugin.class);
        registerPlugin(DeviceActivityPlugin.class);
        registerPlugin(ScreenGlancePlugin.class);
        super.onCreate(savedInstanceState);
        configureStableWebView();
        PushNotificationWorker.ensureNotificationChannel(this);
        PushNotificationWorker.schedule(this);
        PushNotificationWorker.markAppVisible(this);
    }

    private void configureStableWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        webView.setLayerType(View.LAYER_TYPE_NONE, null);
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView crashedView, RenderProcessGoneDetail detail) {
                Log.e(
                    TAG,
                    "WebView renderer exited; scheduling a safe activity restart. didCrash="
                        + detail.didCrash()
                );
                if (!rendererRecoveryScheduled) {
                    rendererRecoveryScheduled = true;
                    crashedView.post(() -> {
                        if (!isFinishing() && !isDestroyed()) {
                            recreate();
                        }
                    });
                }
                return true;
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        PushNotificationWorker.markAppVisible(this);
    }

    @Override
    public void onPause() {
        PushNotificationWorker.markAppVisible(this);
        super.onPause();
    }
}
