package com.diskreid.vrcnextmobile;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private boolean rendererStopped;

    @Override public void onCreate(Bundle savedInstanceState) {
        AppDiagnostics.install(this);
        registerPlugin(VrcNativePlugin.class);
        registerPlugin(AppDiagnosticsPlugin.class);
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (rendererStopped) return true;
                rendererStopped = true;
                AppDiagnostics.rendererStopped(MainActivity.this, detail.didCrash());
                // Retire the dead bridge before showing a native screen; lifecycle callbacks must not reuse its WebView.
                Bridge stoppedBridge = bridge;
                bridge = null;
                if (stoppedBridge != null) {
                    try { stoppedBridge.onDestroy(); } catch (RuntimeException ignored) { }
                }
                try {
                    if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                    view.destroy();
                } catch (RuntimeException ignored) { /* Always retain access to the native recovery screen. */ }
                showRendererRecovery();
                return true;
            }
        });
        super.onCreate(savedInstanceState);
        ScreenProtection.apply(this);
    }

    private void showRendererRecovery() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.rgb(16, 19, 28));
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding * 2, padding, padding);
        TextView title = new TextView(this);
        title.setText("Компонент WebView остановился");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        layout.addView(title);
        TextView explanation = new TextView(this);
        explanation.setText("Можно перезапустить интерфейс. Сохранённая сессия останется на устройстве. Если сбой повторится, скопируйте локальную диагностику и проверьте обновление Android System WebView.");
        explanation.setTextColor(Color.rgb(179, 184, 203));
        explanation.setTextSize(15);
        explanation.setPadding(0, padding, 0, padding);
        layout.addView(explanation);
        Button restart = new Button(this);
        restart.setText("Перезапустить интерфейс");
        restart.setOnClickListener(view -> recreate());
        layout.addView(restart);
        Button copy = new Button(this);
        copy.setText("Скопировать диагностику");
        copy.setOnClickListener(view -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("VRCNext Mobile diagnostics", AppDiagnostics.getReport(this).text));
                    Toast.makeText(this, "Диагностика скопирована", Toast.LENGTH_SHORT).show();
                }
            } catch (RuntimeException unavailable) {
                Toast.makeText(this, "Не удалось скопировать диагностику", Toast.LENGTH_SHORT).show();
            }
        });
        layout.addView(copy);
        setContentView(layout);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { finish(); }
        });
    }
}
