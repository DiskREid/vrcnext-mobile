package com.diskreid.vrcnextmobile;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

@CapacitorPlugin(name = "AppDiagnostics")
public class AppDiagnosticsPlugin extends Plugin {
    private final LifecycleTasks tasks = new LifecycleTasks();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final AtomicLong lastWebFailureAt = new AtomicLong();

    private void release(PluginCall call) {
        try { if (getBridge() != null) call.release(getBridge()); }
        catch (RuntimeException retiredBridge) { /* No WebView remains to receive this call. */ }
    }

    private void reply(PluginCall call, Runnable response) {
        if (tasks.isClosed()) { release(call); return; }
        try { response.run(); }
        catch (RuntimeException retiredBridge) { release(call); }
    }

    private void resolve(PluginCall call) { reply(call, call::resolve); }
    private void resolve(PluginCall call, JSObject data) { reply(call, () -> call.resolve(data)); }
    private void reject(PluginCall call, String message, String code) { reply(call, () -> call.reject(message, code)); }

    private void submit(PluginCall call, Runnable work) {
        tasks.execute(io, work, () -> {
            if (tasks.isClosed()) release(call);
            else reject(call, "This screen is no longer available", "DIAGNOSTICS_CANCELLED");
        });
    }

    @PluginMethod public void getReport(PluginCall call) {
        submit(call, () -> {
            try {
                AppDiagnostics.Report report = AppDiagnostics.getReport(getContext());
                resolve(call, new JSObject().put("text", report.text).put("hasPreviousCrash", report.hasPreviousCrash));
            } catch (RuntimeException unavailable) {
                reject(call, "Local diagnostics are unavailable", "DIAGNOSTICS_UNAVAILABLE");
            }
        });
    }

    @PluginMethod public void copyReport(PluginCall call) {
        submit(call, () -> {
            try {
                String text = AppDiagnostics.getReport(getContext()).text;
                android.app.Activity activity = getActivity();
                if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                    reject(call, "Diagnostics screen is no longer available", "DIAGNOSTICS_CANCELLED");
                    return;
                }
                activity.runOnUiThread(() -> {
                    if (tasks.isClosed()) { release(call); return; }
                    try {
                        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                        if (clipboard == null) throw new IllegalStateException();
                        clipboard.setPrimaryClip(ClipData.newPlainText("VRCNext Mobile diagnostics", text));
                        resolve(call);
                    } catch (RuntimeException unavailable) {
                        reject(call, "Could not copy local diagnostics", "DIAGNOSTICS_CLIPBOARD_ERROR");
                    }
                });
            } catch (RuntimeException unavailable) {
                reject(call, "Local diagnostics are unavailable", "DIAGNOSTICS_UNAVAILABLE");
            }
        });
    }

    @PluginMethod public void recordWebFailure(PluginCall call) {
        final String kind = call.getString("kind", "");
        final String name = call.getString("name", "");
        try { DiagnosticReport.webFailure(kind, name); }
        catch (IllegalArgumentException invalid) {
            reject(call, "Unsupported diagnostic category", "INVALID_DIAGNOSTIC");
            return;
        }
        long now = android.os.SystemClock.elapsedRealtime();
        long previous = lastWebFailureAt.get();
        if ((previous != 0 && now - previous < 5000) || !lastWebFailureAt.compareAndSet(previous, now)) {
            resolve(call);
            return;
        }
        submit(call, () -> {
            try {
                if (!AppDiagnostics.recordWebFailure(getContext(), kind, name)) throw new IllegalStateException();
                resolve(call);
            } catch (RuntimeException unavailable) {
                reject(call, "Could not record local diagnostics", "DIAGNOSTICS_STORAGE_ERROR");
            }
        });
    }

    @PluginMethod public void clearReport(PluginCall call) {
        submit(call, () -> {
            try {
                if (!AppDiagnostics.clearReport(getContext())) throw new IllegalStateException();
                resolve(call);
            } catch (RuntimeException unavailable) {
                reject(call, "Could not clear local diagnostics", "DIAGNOSTICS_STORAGE_ERROR");
            }
        });
    }

    @Override protected void handleOnDestroy() { tasks.close(); io.shutdownNow(); }
}
