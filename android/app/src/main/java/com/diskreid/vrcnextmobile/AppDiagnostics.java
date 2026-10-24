package com.diskreid.vrcnextmobile;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.webkit.WebView;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicBoolean;

/** Local, bounded diagnostics; no account data, request details or remote reporting. */
final class AppDiagnostics {
    private static final String PREFERENCES = "local_startup_diagnostics";
    private static final AtomicBoolean INSTALLED = new AtomicBoolean();
    private static final AtomicBoolean RECORDING = new AtomicBoolean();

    static final class Report {
        final String text;
        final boolean hasPreviousCrash;
        Report(String text, boolean hasPreviousCrash) { this.text = text; this.hasPreviousCrash = hasPreviousCrash; }
    }

    private AppDiagnostics() { }

    static void install(Context context) {
        if (context == null || !INSTALLED.compareAndSet(false, true)) return;
        final Context app = context.getApplicationContext();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        try {
            Thread.setDefaultUncaughtExceptionHandler((thread, failure) -> {
                if (!(failure instanceof ThreadDeath) && RECORDING.compareAndSet(false, true)) {
                    try { save(app, DiagnosticReport.exceptionSummary(failure)); }
                    catch (Throwable ignored) { /* Diagnostics must never replace the original failure. */ }
                    finally { RECORDING.set(false); }
                }
                if (previous != null) previous.uncaughtException(thread, failure);
                else {
                    android.os.Process.killProcess(android.os.Process.myPid());
                    System.exit(10);
                }
            });
        } catch (RuntimeException unavailable) { INSTALLED.set(false); }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static void save(Context context, String structure) {
        if (context == null) return;
        preferences(context).edit().putString("failure", structure)
                .putLong("failure_at", System.currentTimeMillis()).commit();
    }

    static void rendererStopped(Context context, boolean didCrash) {
        try { save(context, "WebView renderer stopped. didCrash=" + didCrash + "\n"); }
        catch (RuntimeException ignored) { /* Recovery screen must remain available if local storage is full. */ }
    }

    static boolean recordWebFailure(Context context, String kind, String name) {
        String failure = DiagnosticReport.webFailure(kind, name);
        return preferences(context).edit().putString("web_failure", failure)
                .putLong("web_failure_at", System.currentTimeMillis()).commit();
    }

    static Report getReport(Context context) {
        StringBuilder report = new StringBuilder("VRCNext Mobile local diagnostics\n");
        boolean hasPreviousCrash = false;
        long clearedAt = 0;
        try {
            PackageInfo app = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            report.append("App: ").append(DiagnosticReport.label(app.versionName)).append('\n');
        } catch (Exception unavailable) { report.append("App: unavailable\n"); }
        report.append("Android API: ").append(Build.VERSION.SDK_INT).append('\n');
        report.append("Device: ").append(DiagnosticReport.label(Build.MANUFACTURER))
                .append(' ').append(DiagnosticReport.label(Build.MODEL)).append('\n');
        try {
            PackageInfo webView = WebView.getCurrentWebViewPackage();
            report.append("WebView: ").append(webView == null ? "unavailable" : DiagnosticReport.label(webView.versionName)).append('\n');
        } catch (RuntimeException unavailable) { report.append("WebView: unavailable\n"); }
        try {
            SharedPreferences preferences = preferences(context);
            clearedAt = preferences.getLong("cleared_at", 0);
            String failure = preferences.getString("failure", null);
            long at = preferences.getLong("failure_at", 0);
            if (failure != null && at > clearedAt) {
                hasPreviousCrash = true;
                report.append("Recorded failure UTC: ").append(utc(at)).append('\n');
                report.append(failure, 0, Math.min(failure.length(), DiagnosticReport.MAX_LENGTH));
            }
            String webFailure = preferences.getString("web_failure", null);
            long webAt = preferences.getLong("web_failure_at", 0);
            if (webFailure != null && webAt > clearedAt) {
                hasPreviousCrash = true;
                report.append("Recorded web failure UTC: ").append(utc(webAt)).append('\n');
                report.append(webFailure, 0, Math.min(webFailure.length(), 128));
            }
        } catch (RuntimeException unavailable) { report.append("Local failure record: unavailable\n"); }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
                List<ApplicationExitInfo> exits = manager == null ? null : manager.getHistoricalProcessExitReasons(context.getPackageName(), 0, 5);
                if (exits != null) for (ApplicationExitInfo exit : exits) {
                    if (exit.getTimestamp() <= clearedAt) continue;
                    int reason = exit.getReason();
                    // Read structural metadata only, never getDescription() or trace input streams.
                    report.append("Process exit UTC: ").append(utc(exit.getTimestamp()))
                            .append(" reason=").append(reason).append(" status=").append(exit.getStatus()).append('\n');
                    if (reason == ApplicationExitInfo.REASON_CRASH || reason == ApplicationExitInfo.REASON_CRASH_NATIVE
                            || reason == ApplicationExitInfo.REASON_ANR || reason == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE)
                        hasPreviousCrash = true;
                }
            } catch (RuntimeException unavailable) { report.append("Process exit metadata: unavailable\n"); }
        }
        if (!hasPreviousCrash) report.append("No recorded crash found. This does not rule out an earlier device or WebView failure.\n");
        report.append("Includes device/app versions and structural failure data only; no credentials, account IDs or HTTP data.\n");
        return new Report(report.toString(), hasPreviousCrash);
    }

    static boolean clearReport(Context context) {
        return preferences(context).edit().clear().putLong("cleared_at", System.currentTimeMillis()).commit();
    }

    private static String utc(long timestamp) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss 'UTC'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(timestamp));
    }
}
