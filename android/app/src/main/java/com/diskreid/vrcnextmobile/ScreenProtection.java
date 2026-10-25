package com.diskreid.vrcnextmobile;

import android.app.Activity;
import android.content.Context;
import android.view.WindowManager;

/** Device preference, independent of account cookies and retained across app updates. */
final class ScreenProtection {
    private static final String PREFERENCES = "display_privacy";
    private static final String ENABLED = "screen_protection";

    private ScreenProtection() { }

    static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(ENABLED, false);
    }

    static void setEnabled(Activity activity, boolean enabled) {
        activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean(ENABLED, enabled).apply();
        apply(activity);
    }

    static void apply(Activity activity) {
        if (isEnabled(activity)) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
